import { ChatGroq } from '@langchain/groq';
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import { sessionManager } from '../websocket/sessionManager';
import { DISPATCHER_SYSTEM_PROMPT, buildContextMessage } from './dispatcherPrompts';
import { conversationMemory } from './memory';
import { parseAgentResponse, Intent, ParsedResponse } from './intentRouter';
import { dispatcherTools, drainToolExecutions, ToolExecutionRecord } from './tools';

// ============================================================
// Orchestrator — the core conversation pipeline
//
// Step 5 upgrade: the orchestrator now uses LangChain tool calling.
// The LLM can invoke backend functions (ETA updates, status changes)
// as part of its response. The orchestrator runs a tool-call loop
// until the LLM produces a final text response.
// ============================================================

export interface OrchestratorResult {
    /** Clean text for TTS (intent tag stripped) */
    text: string;
    /** Detected intent from the driver's message */
    intent: Intent;
    /** Raw LLM response before parsing */
    rawResponse: string;
    /** Tools that were executed during this turn */
    toolExecutions: ToolExecutionRecord[];
}

const DEFAULT_MODEL = 'llama3-70b-8192';
const MAX_TOOL_ITERATIONS = 5;

class DispatcherOrchestrator {
    private readonly llm: ChatGroq;
    private readonly llmWithTools: ReturnType<ChatGroq['bindTools']>;
    private readonly modelName: string;

    constructor() {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error(
                'GROQ_API_KEY is required for the dispatcher orchestrator. ' +
                'Set it in .env or environment variables.'
            );
        }

        this.modelName = process.env.GROQ_MODEL || DEFAULT_MODEL;

        this.llm = new ChatGroq({
            apiKey: apiKey,
            model: this.modelName,
            temperature: 0.7,
            maxTokens: 500,
        });

        // Bind tools so the LLM can call them
        this.llmWithTools = this.llm.bindTools(dispatcherTools);

        console.log(
            `[Orchestrator] Initialized with model: ${this.modelName}, ` +
            `tools: ${dispatcherTools.map((t) => t.name).join(', ')}`
        );
    }

    /**
     * Process a driver's transcribed speech and produce an agent response.
     *
     * Flow:
     * 1. Record the driver's message in memory + transcript
     * 2. Build the full message array (system + context + history)
     * 3. Call the LLM with tool bindings
     * 4. If the LLM requests tool calls, execute them and loop
     * 5. Parse the final text response for intent
     * 6. Store the agent response and return
     */
    async processDriverMessage(
        sessionId: string,
        transcription: string
    ): Promise<OrchestratorResult> {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        if (!session.driver) {
            throw new Error(
                `Session ${sessionId} has no identified driver. ` +
                'Send call.start before driver.transcription.'
            );
        }

        const trimmedText = transcription.trim();
        if (!trimmedText) {
            throw new Error('Cannot process empty transcription');
        }

        // 1. Record the driver's message
        conversationMemory.addDriverMessage(sessionId, trimmedText);
        sessionManager.addTranscript(sessionId, 'driver', trimmedText);

        // 2. Build the message array for the LLM
        const contextText = buildContextMessage(session);
        const history = conversationMemory.getHistory(sessionId);

        const messages: BaseMessage[] = [
            new SystemMessage(DISPATCHER_SYSTEM_PROMPT),
            new SystemMessage(`## Operational Context\n${contextText}`),
            // Inject session_id and driver_id so the LLM can pass them to tools
            new SystemMessage(
                `## Tool Context\n` +
                `When calling tools, use these values:\n` +
                `- session_id: "${sessionId}"\n` +
                `- driver_id: "${session.driver.id}"`
            ),
            ...history,
        ];

        // 3. Call the LLM with tool-call loop
        console.log(
            `[Orchestrator] Processing message for session ${sessionId}: ` +
            `"${trimmedText.substring(0, 80)}${trimmedText.length > 80 ? '...' : ''}"`
        );

        let finalText = '';
        let iterations = 0;

        // Clear any stale tool execution records
        drainToolExecutions();

        while (iterations < MAX_TOOL_ITERATIONS) {
            iterations++;

            const response = await this.llmWithTools.invoke(messages);

            // Check if the LLM wants to call tools
            const toolCalls = response.tool_calls;

            if (!toolCalls || toolCalls.length === 0) {
                // No tool calls — this is the final text response
                finalText = typeof response.content === 'string'
                    ? response.content
                    : JSON.stringify(response.content);
                break;
            }

            // LLM wants to call tools — execute them
            console.log(
                `[Orchestrator] Tool calls requested (iteration ${iterations}): ` +
                toolCalls.map((tc) => tc.name).join(', ')
            );

            // Add the AI message with tool calls to the conversation
            messages.push(response);

            // Execute each tool call and collect results
            for (const toolCall of toolCalls) {
                const matchedTool = dispatcherTools.find((t) => t.name === toolCall.name);
                if (!matchedTool) {
                    const errorMsg = `Unknown tool: ${toolCall.name}`;
                    console.error(`[Orchestrator] ${errorMsg}`);
                    messages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id ?? '',
                            content: `Error: ${errorMsg}`,
                        })
                    );
                    continue;
                }

                try {
                    // Inject session_id into tool args if missing
                    const args = { ...toolCall.args, session_id: sessionId };

                    console.log(
                        `[Orchestrator] Executing tool: ${toolCall.name}(${JSON.stringify(args)})`
                    );

                    // Use the matched tool's invoke — cast to any to resolve
                    // heterogeneous union signature incompatibility
                    const toolResult = await (matchedTool as any).invoke(args);
                    const resultStr = typeof toolResult === 'string'
                        ? toolResult
                        : JSON.stringify(toolResult);

                    console.log(`[Orchestrator] Tool result: ${resultStr}`);

                    messages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id ?? '',
                            content: resultStr,
                        })
                    );
                } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : 'Tool execution failed';
                    console.error(`[Orchestrator] Tool error (${toolCall.name}):`, errorMsg);
                    messages.push(
                        new ToolMessage({
                            tool_call_id: toolCall.id ?? '',
                            content: `Error: ${errorMsg}`,
                        })
                    );
                }
            }
        }

        if (!finalText) {
            finalText = 'I apologize, I had trouble processing that. Could you repeat your request?';
            console.warn(
                `[Orchestrator] Max tool iterations (${MAX_TOOL_ITERATIONS}) reached ` +
                `for session ${sessionId}`
            );
        }

        // 4. Collect tool execution records
        const toolExecutions = drainToolExecutions();

        // 5. Parse the response for intent and clean text
        const parsed: ParsedResponse = parseAgentResponse(finalText);

        // Fallback for empty text to prevent TTS crashes
        if (!parsed.text) {
            console.warn(`[Orchestrator] Parsed text is empty from raw response: "${finalText}". Using fallback text.`);
            parsed.text = "Got it. I've updated the system.";
        }

        // 6. Store the agent's response in memory and session transcript
        conversationMemory.addAgentMessage(sessionId, parsed.text);
        sessionManager.addTranscript(sessionId, 'agent', parsed.text);

        console.log(
            `[Orchestrator] Response for session ${sessionId}: ` +
            `intent=${parsed.intent}, ` +
            `tools=${toolExecutions.length}, ` +
            `text="${parsed.text.substring(0, 80)}${parsed.text.length > 80 ? '...' : ''}"`
        );

        return {
            text: parsed.text,
            intent: parsed.intent,
            rawResponse: finalText,
            toolExecutions,
        };
    }

    /**
     * Clean up orchestrator state for a session.
     * Called when a call ends.
     */
    endSession(sessionId: string): void {
        conversationMemory.clearMemory(sessionId);
        console.log(`[Orchestrator] Session cleaned up: ${sessionId}`);
    }

    /** Get the configured model name */
    getModelName(): string {
        return this.modelName;
    }
}

/** Singleton orchestrator instance */
export const dispatcherOrchestrator = new DispatcherOrchestrator();
