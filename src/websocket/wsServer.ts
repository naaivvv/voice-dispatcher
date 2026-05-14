import { Server as HTTPServer } from 'http';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { elevenLabsTts } from '../voice';
import { dispatcherOrchestrator } from '../agent';
import { sessionManager, CallSession } from './sessionManager';
import { AUDIO_CONFIG, ClientMessage, ServerMessage } from './types';
import { TurnTimer } from '../utils/metrics';
import {
    authenticateWebSocket,
    checkWsConnectionLimit,
    getRequestIp,
    isAllowedWsOrigin,
    securityConfig,
    selectWebSocketProtocol,
    wsAgentTurnLimiter,
    wsMessageLimiter,
} from '../security';

function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

async function streamDispatcherSpeech(
    session: CallSession,
    message: Extract<ClientMessage, { type: 'dispatcher.speak' }>
): Promise<void> {
    const { ws } = session;
    const text = message.text.trim();

    if (!text) {
        send(ws, { type: 'error', message: 'dispatcher.speak requires text' });
        return;
    }

    send(ws, { type: 'agent.thinking' });
    send(ws, { type: 'agent.speaking', text });
    send(ws, {
        type: 'audio.output.start',
        format: message.output_format || AUDIO_CONFIG.outputFormat,
        sample_rate: AUDIO_CONFIG.outputSampleRate,
        voice_id: message.voice_id || elevenLabsTts.getConfig().defaultVoiceId,
        text,
    });

    session.abortController = new AbortController();

    try {
        const bytes = await elevenLabsTts.streamSpeech({
            text,
            voiceId: message.voice_id,
            modelId: message.model_id,
            outputFormat: message.output_format,
            abortSignal: session.abortController.signal,
            onChunk: (chunk) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(chunk, { binary: true });
                }
            },
        });

        sessionManager.addTranscript(session.id, 'agent', text);
        send(ws, { type: 'audio.output.done', bytes });
        send(ws, { type: 'agent.done' });
    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.log(`[WS] Dispatcher speech aborted for session ${session.id}`);
        } else {
            throw err;
        }
    } finally {
        session.abortController = null;
    }
}

async function handleControlMessage(
    session: CallSession,
    message: ClientMessage
): Promise<void> {
    const { ws } = session;

    switch (message.type) {
        case 'call.start': {
            const { phone_number } = message;
            console.log(`[WS] call.start from phone: ${phone_number}`);

            const driver = await sessionManager.identifyDriver(session.id, phone_number);

            if (!driver) {
                send(ws, {
                    type: 'error',
                    message: `No driver found for phone number: ${phone_number}`,
                });
                send(ws, { type: 'session.ended', reason: 'driver_not_found' });
                ws.close();
                return;
            }

            send(ws, {
                type: 'session.created',
                session_id: session.id,
                driver: {
                    id: driver.id,
                    name: driver.name,
                    status: driver.status,
                },
            });

            const deliveryCount = session.activeDeliveries.length;
            const contextMsg = deliveryCount > 0
                ? `Connected with ${driver.name}. ${deliveryCount} active delivery(deliveries). Ready for conversation.`
                : `Connected with ${driver.name}. No active deliveries found.`;

            send(ws, {
                type: 'session.ready',
                message: contextMsg,
            });

            console.log(`[WS] Session ${session.id} ready: ${contextMsg}`);
            break;
        }

        case 'dispatcher.speak': {
            if (session.state !== 'active') {
                send(ws, {
                    type: 'error',
                    message: 'Call must be started before dispatcher speech can stream',
                });
                return;
            }

            try {
                await streamDispatcherSpeech(session, message);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown TTS failure';
                console.error(`[WS] TTS error for session ${session.id}:`, errorMessage);
                send(ws, {
                    type: 'error',
                    message: 'Dispatcher speech failed',
                });
                send(ws, { type: 'agent.done' });
            }
            break;
        }

        case 'driver.transcription': {
            if (session.state !== 'active' && session.state !== 'processing') {
                send(ws, {
                    type: 'error',
                    message: 'Call must be started before sending transcriptions',
                });
                return;
            }

            const transcription = message.text?.trim();
            if (!transcription) {
                send(ws, { type: 'error', message: 'driver.transcription requires text' });
                return;
            }

            const agentTurnLimit = wsAgentTurnLimiter.consume(session.id);
            if (!agentTurnLimit.allowed) {
                console.warn(`[Security] WS agent turn rate limit exceeded for session ${session.id}`);
                send(ws, {
                    type: 'error',
                    message: 'Too many agent requests. Please wait before sending another update.',
                });
                return;
            }

            // Abort any active TTS playing to the driver
            if (session.abortController) {
                console.log(`[WS] driver.transcription interrupting active TTS for session ${session.id}`);
                session.abortController.abort('new_transcription');
                session.abortController = null;
                send(ws, { type: 'audio.interrupted' });
            }

            // Prevent concurrent processing runs
            if (session.state === 'processing') {
                console.log(`[WS] Skipping driver.transcription: session ${session.id} is already processing`);
                return;
            }
            session.state = 'processing';

            const timer = new TurnTimer(session.id, session.metrics.turnCount + 1);

            try {
                send(ws, { type: 'agent.thinking' });

                timer.start('llm');
                // Process through the LangChain orchestrator
                const result = await dispatcherOrchestrator.processDriverMessage(
                    session.id,
                    transcription
                );
                timer.end('llm');

                // Send the structured response (text + intent) for client logic
                send(ws, {
                    type: 'agent.response',
                    text: result.text,
                    intent: result.intent,
                });

                // Notify client about any tools that were executed
                for (const exec of result.toolExecutions) {
                    send(ws, {
                        type: 'action.executed',
                        tool: exec.tool,
                        result: exec.result,
                    });
                }

                // Stream TTS audio of the agent's response
                send(ws, { type: 'agent.speaking', text: result.text });
                send(ws, {
                    type: 'audio.output.start',
                    format: AUDIO_CONFIG.outputFormat,
                    sample_rate: AUDIO_CONFIG.outputSampleRate,
                    voice_id: elevenLabsTts.getConfig().defaultVoiceId,
                    text: result.text,
                });

                session.abortController = new AbortController();

                timer.start('tts');
                const bytes = await elevenLabsTts.streamSpeech({
                    text: result.text,
                    abortSignal: session.abortController.signal,
                    onChunk: (chunk) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(chunk, { binary: true });
                        }
                    },
                });
                timer.end('tts');

                send(ws, { type: 'audio.output.done', bytes });
                send(ws, { type: 'agent.done' });
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    console.log(`[WS] Orchestrator speech aborted for session ${session.id}`);
                } else {
                    const errorMessage = err instanceof Error ? err.message : 'Unknown orchestrator failure';
                    console.error(`[WS] Orchestrator error for session ${session.id}:`, errorMessage);
                    send(ws, {
                        type: 'error',
                        message: 'Agent processing failed',
                    });
                    send(ws, { type: 'agent.done' });
                }
            } finally {
                session.state = 'active';
                session.abortController = null;
                const turnMetrics = timer.finalize();
                session.metrics.record(turnMetrics);
            }
            break;
        }

        case 'driver.interrupt': {
            if (session.abortController) {
                console.log(`[WS] driver.interrupt for session ${session.id}: aborting active TTS`);
                session.abortController.abort('driver_interrupted');
                session.abortController = null;
                send(ws, { type: 'audio.interrupted' });
            }
            break;
        }

        case 'call.end': {
            console.log(`[WS] call.end for session: ${session.id}`);
            send(ws, { type: 'session.ended', reason: 'client_hangup' });
            dispatcherOrchestrator.endSession(session.id);
            sessionManager.endSession(session.id);
            ws.close();
            break;
        }

        default: {
            send(ws, {
                type: 'error',
                message: `Unknown message type: ${(message as { type: string }).type}`,
            });
        }
    }
}

function handleAudioFrame(session: CallSession, data: Buffer): void {
    if (session.state !== 'active') {
        return;
    }

    sessionManager.pushAudio(session.id, data);
}

export function createWebSocketServer(httpServer: HTTPServer): WebSocketServer {
    const connectionsByIp = new Map<string, number>();

    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws/call',
        maxPayload: securityConfig.wsMaxJsonBytes,
        handleProtocols: selectWebSocketProtocol,
        verifyClient: (info, done) => {
            const ip = getRequestIp(info.req);

            if (!isAllowedWsOrigin(info.req)) {
                console.warn(`[Security] WebSocket rejected from disallowed origin: ${info.origin || 'none'}`);
                done(false, 403, 'Forbidden');
                return;
            }

            if (!authenticateWebSocket(info.req)) {
                console.warn(`[Security] WebSocket rejected for missing/invalid token from ${ip}`);
                done(false, 401, 'Unauthorized');
                return;
            }

            const activeForIp = connectionsByIp.get(ip) ?? 0;
            if (activeForIp >= securityConfig.wsMaxConnectionsPerIp) {
                console.warn(`[Security] WebSocket concurrent connection limit exceeded for ${ip}`);
                done(false, 429, 'Too Many Requests');
                return;
            }

            if (!checkWsConnectionLimit(info.req)) {
                done(false, 429, 'Too Many Requests');
                return;
            }

            done(true);
        },
    });

    console.log('[WS] WebSocket server initialized on /ws/call');

    wss.on('connection', (ws: WebSocket, req) => {
        const ip = getRequestIp(req);
        connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);

        const session = sessionManager.createSession(ws);
        console.log(
            `[WS] New connection: session ${session.id} ` +
            `(active sessions: ${sessionManager.activeCount})`
        );

        ws.on('message', async (raw: RawData, isBinary: boolean) => {
            try {
                const messageLimit = wsMessageLimiter.consume(session.id);
                if (!messageLimit.allowed) {
                    console.warn(`[Security] WS message rate limit exceeded for session ${session.id}`);
                    send(ws, { type: 'error', message: 'Too many messages. Please slow down.' });
                    return;
                }

                if (isBinary) {
                    handleAudioFrame(session, raw as Buffer);
                } else {
                    const text = raw.toString('utf-8');
                    if (Buffer.byteLength(text, 'utf-8') > securityConfig.wsMaxJsonBytes) {
                        console.warn(`[Security] WS JSON payload too large for session ${session.id}`);
                        send(ws, { type: 'error', message: 'Message payload is too large' });
                        ws.close(1009, 'message_too_large');
                        return;
                    }

                    const message: ClientMessage = JSON.parse(text);
                    await handleControlMessage(session, message);
                }
            } catch (err) {
                console.error('[WS] Error processing message:', err);
                send(ws, {
                    type: 'error',
                    message: 'Failed to process message',
                });
            }
        });

        ws.on('close', (code: number, reason: Buffer) => {
            console.log(
                `[WS] Connection closed: session ${session.id}, ` +
                `code: ${code}, reason: ${reason.toString() || 'none'}`
            );
            dispatcherOrchestrator.endSession(session.id);
            sessionManager.endSession(session.id);
            const activeForIp = connectionsByIp.get(ip) ?? 0;
            if (activeForIp <= 1) {
                connectionsByIp.delete(ip);
            } else {
                connectionsByIp.set(ip, activeForIp - 1);
            }
        });

        ws.on('error', (err: Error) => {
            console.error(`[WS] Connection error: session ${session.id}:`, err.message);
            sessionManager.endSession(session.id);
        });

        ws.on('pong', () => {
            // Heartbeat acknowledged by client.
        });
    });

    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            }
        });
    }, 30_000);

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
        console.log('[WS] WebSocket server closed');
    });

    return wss;
}
