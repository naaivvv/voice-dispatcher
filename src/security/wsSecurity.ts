import { IncomingMessage } from 'http';
import { supabase } from '../db/supabaseClient';
import { normalizeOrigin, securityConfig } from './config';
import { FixedWindowRateLimiter } from './rateLimiter';

const connectionLimiter = new FixedWindowRateLimiter(60_000, securityConfig.wsMaxConnectionsPerIp);

export const wsMessageLimiter = new FixedWindowRateLimiter(
    60_000,
    securityConfig.wsMessageRateLimitPerMinute
);

export const wsAgentTurnLimiter = new FixedWindowRateLimiter(
    60_000,
    securityConfig.wsAgentTurnLimitPerMinute
);

export function getRequestIp(req: IncomingMessage): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.socket.remoteAddress || 'unknown';
}

export function getWebSocketProtocols(req: IncomingMessage): string[] {
    const raw = req.headers['sec-websocket-protocol'];
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map((protocol) => protocol.trim())
        .filter(Boolean);
}

export function isAllowedWsOrigin(req: IncomingMessage): boolean {
    if (securityConfig.allowedOrigins.length === 0) {
        return true;
    }

    const origin = req.headers.origin;
    return !origin || securityConfig.allowedOrigins.includes(normalizeOrigin(origin));
}

export interface WebSocketAuthResult {
    ok: boolean;
    userId?: string;
    reason?: string;
}

function getBearerProtocol(req: IncomingMessage): string | null {
    const protocols = getWebSocketProtocols(req);
    return protocols.find((protocol) => protocol !== 'voice-dispatcher') ?? null;
}

export async function authenticateWebSocket(req: IncomingMessage): Promise<WebSocketAuthResult> {
    const token = getBearerProtocol(req);

    if (!token) {
        return { ok: false, reason: 'missing Supabase access token protocol' };
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
        return { ok: false, reason: error?.message || 'invalid Supabase access token' };
    }

    return { ok: true, userId: data.user.id };
}

export function checkWsConnectionLimit(req: IncomingMessage): boolean {
    const ip = getRequestIp(req);
    const result = connectionLimiter.consume(ip);
    if (!result.allowed) {
        console.warn(`[Security] WebSocket connection rate limit exceeded for ${ip}`);
        return false;
    }
    return true;
}

export function selectWebSocketProtocol(protocols: Set<string>): string | false {
    if (protocols.has('voice-dispatcher')) {
        return 'voice-dispatcher';
    }

    return false;
}
