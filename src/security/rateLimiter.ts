export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

interface RateLimitBucket {
    count: number;
    resetAt: number;
}

export class FixedWindowRateLimiter {
    private readonly buckets = new Map<string, RateLimitBucket>();

    constructor(
        private readonly windowMs: number,
        private readonly maxRequests: number
    ) {}

    consume(key: string): RateLimitResult {
        const now = Date.now();
        const bucket = this.buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            this.buckets.set(key, {
                count: 1,
                resetAt: now + this.windowMs,
            });
            return { allowed: true, retryAfterSeconds: 0 };
        }

        if (bucket.count >= this.maxRequests) {
            return {
                allowed: false,
                retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
            };
        }

        bucket.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
    }

    clear(key: string): void {
        this.buckets.delete(key);
    }
}

