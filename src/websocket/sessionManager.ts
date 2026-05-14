import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { Driver, Delivery } from '../db/types';
import { getDriverByPhone } from '../db/driverService';
import { getActiveDeliveriesForDriver } from '../db/deliveryService';

// ============================================================
// Call Session — one per active WebSocket connection
// ============================================================

export interface CallSession {
    /** Unique session identifier */
    id: string;
    /** The connected WebSocket */
    ws: WebSocket;
    /** Driver associated with this call (set after identification) */
    driver: Driver | null;
    /** Active deliveries for this driver */
    activeDeliveries: Delivery[];
    /** Buffered audio chunks from the driver (raw PCM) */
    audioBuffer: Buffer[];
    /** Conversation transcript for context */
    transcript: Array<{ role: 'driver' | 'agent'; text: string; timestamp: Date }>;
    /** Session state */
    state: 'connecting' | 'active' | 'processing' | 'ended';
    /** When the call started */
    startedAt: Date;
    /** When the call ended */
    endedAt: Date | null;
}

// ============================================================
// Session Manager — tracks all active call sessions
// ============================================================

class SessionManager {
    private sessions: Map<string, CallSession> = new Map();

    /**
     * Create a new session for an incoming WebSocket connection.
     */
    createSession(ws: WebSocket): CallSession {
        const session: CallSession = {
            id: uuidv4(),
            ws,
            driver: null,
            activeDeliveries: [],
            audioBuffer: [],
            transcript: [],
            state: 'connecting',
            startedAt: new Date(),
            endedAt: null,
        };

        this.sessions.set(session.id, session);
        console.log(`[SessionManager] Session created: ${session.id}`);
        return session;
    }

    /**
     * Identify the driver by phone number and load their active deliveries.
     * Returns null if the phone number doesn't match any driver.
     */
    async identifyDriver(sessionId: string, phoneNumber: string): Promise<Driver | null> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.error(`[SessionManager] Session not found: ${sessionId}`);
            return null;
        }

        const driver = await getDriverByPhone(phoneNumber);
        if (!driver) {
            console.warn(`[SessionManager] No driver found for phone: ${phoneNumber}`);
            return null;
        }

        // Load active deliveries for context
        const deliveries = await getActiveDeliveriesForDriver(driver.id);

        session.driver = driver;
        session.activeDeliveries = deliveries;
        session.state = 'active';

        console.log(
            `[SessionManager] Driver identified: ${driver.name} (${driver.id}) ` +
            `with ${deliveries.length} active deliveries`
        );

        return driver;
    }

    /**
     * Append an audio chunk to the session buffer.
     */
    pushAudio(sessionId: string, chunk: Buffer): void {
        const session = this.sessions.get(sessionId);
        if (session && session.state === 'active') {
            session.audioBuffer.push(chunk);
        }
    }

    /**
     * Drain and return all buffered audio, clearing the buffer.
     */
    drainAudioBuffer(sessionId: string): Buffer {
        const session = this.sessions.get(sessionId);
        if (!session || session.audioBuffer.length === 0) {
            return Buffer.alloc(0);
        }

        const combined = Buffer.concat(session.audioBuffer);
        session.audioBuffer = [];
        return combined;
    }

    /**
     * Add a transcript entry to the conversation history.
     */
    addTranscript(sessionId: string, role: 'driver' | 'agent', text: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.transcript.push({ role, text, timestamp: new Date() });
            console.log(`[SessionManager] [${role.toUpperCase()}] ${text}`);
        }
    }

    /**
     * Get a session by ID.
     */
    getSession(sessionId: string): CallSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * End and clean up a session.
     */
    endSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.state = 'ended';
            session.endedAt = new Date();
            session.audioBuffer = [];

            const duration = session.endedAt.getTime() - session.startedAt.getTime();
            console.log(
                `[SessionManager] Session ended: ${sessionId} ` +
                `(duration: ${(duration / 1000).toFixed(1)}s, ` +
                `turns: ${session.transcript.length})`
            );

            this.sessions.delete(sessionId);
        }
    }

    /**
     * Get count of active sessions.
     */
    get activeCount(): number {
        return this.sessions.size;
    }

    /**
     * Get all active session summaries (for monitoring).
     */
    getActiveSessions(): Array<{
        id: string;
        driverName: string | null;
        state: string;
        duration: number;
        turns: number;
    }> {
        const now = Date.now();
        return Array.from(this.sessions.values()).map((s) => ({
            id: s.id,
            driverName: s.driver?.name ?? null,
            state: s.state,
            duration: Math.round((now - s.startedAt.getTime()) / 1000),
            turns: s.transcript.length,
        }));
    }
}

/** Singleton session manager instance */
export const sessionManager = new SessionManager();
