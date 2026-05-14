import { Server as HTTPServer } from 'http';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { elevenLabsTts } from '../voice';
import { sessionManager, CallSession } from './sessionManager';
import { AUDIO_CONFIG, ClientMessage, ServerMessage } from './types';

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

    const bytes = await elevenLabsTts.streamSpeech({
        text,
        voiceId: message.voice_id,
        modelId: message.model_id,
        outputFormat: message.output_format,
        onChunk: (chunk) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(chunk, { binary: true });
            }
        },
    });

    sessionManager.addTranscript(session.id, 'agent', text);
    send(ws, { type: 'audio.output.done', bytes });
    send(ws, { type: 'agent.done' });
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
                    message: `Dispatcher speech failed: ${errorMessage}`,
                });
                send(ws, { type: 'agent.done' });
            }
            break;
        }

        case 'call.end': {
            console.log(`[WS] call.end for session: ${session.id}`);
            send(ws, { type: 'session.ended', reason: 'client_hangup' });
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
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws/call',
    });

    console.log('[WS] WebSocket server initialized on /ws/call');

    wss.on('connection', (ws: WebSocket) => {
        const session = sessionManager.createSession(ws);
        console.log(
            `[WS] New connection: session ${session.id} ` +
            `(active sessions: ${sessionManager.activeCount})`
        );

        ws.on('message', async (raw: RawData, isBinary: boolean) => {
            try {
                if (isBinary) {
                    handleAudioFrame(session, raw as Buffer);
                } else {
                    const text = raw.toString('utf-8');
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
            sessionManager.endSession(session.id);
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
