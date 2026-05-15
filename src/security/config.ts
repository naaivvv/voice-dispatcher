export interface SecurityConfig {
    clientToken: string | null;
    allowedOrigins: string[];
    allowPrivateNetworkOrigins: boolean;
    httpRateLimitWindowMs: number;
    httpRateLimitMax: number;
    wsMaxConnectionsPerIp: number;
    wsMessageRateLimitPerMinute: number;
    wsAgentTurnLimitPerMinute: number;
    wsMaxJsonBytes: number;
}

function numberFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanFromEnv(name: string, fallback = false): boolean {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function normalizeOrigin(origin: string): string {
    return origin.trim().replace(/\/+$/, '');
}

function listFromEnv(name: string): string[] {
    const raw = process.env[name];
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map(normalizeOrigin)
        .filter(Boolean);
}

export const securityConfig: SecurityConfig = {
    clientToken: process.env.DISPATCHER_CLIENT_TOKEN || null,
    allowedOrigins: listFromEnv('ALLOWED_ORIGINS'),
    allowPrivateNetworkOrigins: booleanFromEnv('ALLOW_PRIVATE_NETWORK_ORIGINS'),
    httpRateLimitWindowMs: numberFromEnv('HTTP_RATE_LIMIT_WINDOW_MS', 60_000),
    httpRateLimitMax: numberFromEnv('HTTP_RATE_LIMIT_MAX', 60),
    wsMaxConnectionsPerIp: numberFromEnv('WS_MAX_CONNECTIONS_PER_IP', 5),
    wsMessageRateLimitPerMinute: numberFromEnv('WS_MESSAGE_RATE_LIMIT_PER_MINUTE', 60),
    wsAgentTurnLimitPerMinute: numberFromEnv('WS_AGENT_TURN_LIMIT_PER_MINUTE', 10),
    wsMaxJsonBytes: numberFromEnv('WS_MAX_JSON_BYTES', 16_384),
};
