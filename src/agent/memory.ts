import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';

// ============================================================
// Conversational Memory — per-session sliding window
// ============================================================

/** A single turn in the conversation history */
export interface MemoryEntry {
    role: 'driver' | 'agent';
    content: string;
    timestamp: Date;
}

/**
 * Default sliding window size (number of individual messages).
 * 20 messages ≈ 10 full exchanges — enough context for a multi-topic
 * call without blowing up token usage.
 */
const DEFAULT_WINDOW_SIZE = 20;

/**
 * In-memory conversation history for a single session.
 * Uses a sliding window to keep the most recent N messages.
 */
class SessionMemory {
    private entries: MemoryEntry[] = [];
    private readonly maxEntries: number;

    constructor(windowSize: number = DEFAULT_WINDOW_SIZE) {
        this.maxEntries = windowSize;
    }

    /** Add a driver (human) message to history */
    addDriverMessage(text: string): void {
        this.entries.push({
            role: 'driver',
            content: text,
            timestamp: new Date(),
        });
        this.trim();
    }

    /** Add an agent (AI dispatcher) message to history */
    addAgentMessage(text: string): void {
        this.entries.push({
            role: 'agent',
            content: text,
            timestamp: new Date(),
        });
        this.trim();
    }

    /**
     * Convert the stored history into LangChain message objects
     * suitable for passing to a ChatModel.
     */
    toMessages(): BaseMessage[] {
        return this.entries.map((entry) =>
            entry.role === 'driver'
                ? new HumanMessage(entry.content)
                : new AIMessage(entry.content)
        );
    }

    /** Get raw entries (for debugging / transcript export) */
    getEntries(): readonly MemoryEntry[] {
        return this.entries;
    }

    /** Number of stored messages */
    get length(): number {
        return this.entries.length;
    }

    /** Clear all entries */
    clear(): void {
        this.entries = [];
    }

    /** Trim to the sliding window size, keeping the most recent messages */
    private trim(): void {
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
    }
}

// ============================================================
// Memory Manager — one SessionMemory per active call
// ============================================================

class ConversationMemoryManager {
    private memories: Map<string, SessionMemory> = new Map();

    /**
     * Get existing memory for a session, or create a new one.
     */
    getOrCreate(sessionId: string, windowSize?: number): SessionMemory {
        let memory = this.memories.get(sessionId);
        if (!memory) {
            memory = new SessionMemory(windowSize);
            this.memories.set(sessionId, memory);
            console.log(`[Memory] Created memory for session: ${sessionId}`);
        }
        return memory;
    }

    /** Add a driver message to a session's memory */
    addDriverMessage(sessionId: string, text: string): void {
        this.getOrCreate(sessionId).addDriverMessage(text);
    }

    /** Add an agent message to a session's memory */
    addAgentMessage(sessionId: string, text: string): void {
        this.getOrCreate(sessionId).addAgentMessage(text);
    }

    /** Get LangChain-formatted message history for a session */
    getHistory(sessionId: string): BaseMessage[] {
        const memory = this.memories.get(sessionId);
        return memory ? memory.toMessages() : [];
    }

    /** Clean up memory when a session ends */
    clearMemory(sessionId: string): void {
        const memory = this.memories.get(sessionId);
        if (memory) {
            console.log(
                `[Memory] Clearing memory for session ${sessionId} ` +
                `(${memory.length} entries)`
            );
            memory.clear();
            this.memories.delete(sessionId);
        }
    }

    /** Number of sessions with active memory */
    get activeCount(): number {
        return this.memories.size;
    }
}

/** Singleton memory manager */
export const conversationMemory = new ConversationMemoryManager();
