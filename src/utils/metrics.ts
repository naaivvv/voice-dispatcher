// ============================================================
// Metrics — lightweight timing & performance logging
// ============================================================

/**
 * A single timed span within a turn (e.g., "llm", "tools", "tts").
 */
export interface TimingSpan {
    name: string;
    durationMs: number;
}

/**
 * Aggregated metrics for a single orchestrator + TTS turn.
 */
export interface TurnMetrics {
    sessionId: string;
    turnIndex: number;
    totalMs: number;
    spans: TimingSpan[];
    timestamp: Date;
}

/**
 * Lightweight stopwatch for measuring named spans within a turn.
 *
 * Usage:
 *   const timer = new TurnTimer('session-123', 5);
 *   timer.start('llm');
 *   await llm.invoke(...);
 *   timer.end('llm');
 *   timer.start('tts');
 *   await tts.stream(...);
 *   timer.end('tts');
 *   const metrics = timer.finalize();
 */
export class TurnTimer {
    private readonly sessionId: string;
    private readonly turnIndex: number;
    private readonly turnStart: number;
    private readonly spans: Map<string, number> = new Map();
    private readonly completed: TimingSpan[] = [];

    constructor(sessionId: string, turnIndex: number) {
        this.sessionId = sessionId;
        this.turnIndex = turnIndex;
        this.turnStart = performance.now();
    }

    /** Start timing a named span */
    start(name: string): void {
        this.spans.set(name, performance.now());
    }

    /** End timing a named span */
    end(name: string): void {
        const startTime = this.spans.get(name);
        if (startTime !== undefined) {
            this.completed.push({
                name,
                durationMs: Math.round(performance.now() - startTime),
            });
            this.spans.delete(name);
        }
    }

    /** Finalize the turn and return aggregated metrics */
    finalize(): TurnMetrics {
        // Auto-close any open spans
        for (const [name] of this.spans) {
            this.end(name);
        }

        const metrics: TurnMetrics = {
            sessionId: this.sessionId,
            turnIndex: this.turnIndex,
            totalMs: Math.round(performance.now() - this.turnStart),
            spans: this.completed,
            timestamp: new Date(),
        };

        // Log performance summary
        const spanSummary = metrics.spans
            .map((s) => `${s.name}=${s.durationMs}ms`)
            .join(', ');

        console.log(
            `[Metrics] Turn #${metrics.turnIndex} session=${metrics.sessionId.substring(0, 8)}… ` +
            `total=${metrics.totalMs}ms [${spanSummary}]`
        );

        return metrics;
    }
}

// ── Session-level metric aggregation ───────────────────────

export interface SessionMetrics {
    totalTurns: number;
    avgTurnMs: number;
    avgLlmMs: number;
    avgTtsMs: number;
    maxTurnMs: number;
    lastTurnMs: number;
}

/**
 * Tracks rolling metrics across all turns in a session.
 */
export class SessionMetricsTracker {
    private turns: TurnMetrics[] = [];

    record(metrics: TurnMetrics): void {
        this.turns.push(metrics);
    }

    summarize(): SessionMetrics {
        if (this.turns.length === 0) {
            return {
                totalTurns: 0,
                avgTurnMs: 0,
                avgLlmMs: 0,
                avgTtsMs: 0,
                maxTurnMs: 0,
                lastTurnMs: 0,
            };
        }

        const totalTurns = this.turns.length;
        const avgTurnMs = Math.round(
            this.turns.reduce((sum, t) => sum + t.totalMs, 0) / totalTurns
        );

        const llmSpans = this.turns
            .flatMap((t) => t.spans)
            .filter((s) => s.name === 'llm');
        const avgLlmMs = llmSpans.length > 0
            ? Math.round(llmSpans.reduce((sum, s) => sum + s.durationMs, 0) / llmSpans.length)
            : 0;

        const ttsSpans = this.turns
            .flatMap((t) => t.spans)
            .filter((s) => s.name === 'tts');
        const avgTtsMs = ttsSpans.length > 0
            ? Math.round(ttsSpans.reduce((sum, s) => sum + s.durationMs, 0) / ttsSpans.length)
            : 0;

        const maxTurnMs = Math.max(...this.turns.map((t) => t.totalMs));
        const lastTurnMs = this.turns[this.turns.length - 1].totalMs;

        return { totalTurns, avgTurnMs, avgLlmMs, avgTtsMs, maxTurnMs, lastTurnMs };
    }

    get turnCount(): number {
        return this.turns.length;
    }

    clear(): void {
        this.turns = [];
    }
}
