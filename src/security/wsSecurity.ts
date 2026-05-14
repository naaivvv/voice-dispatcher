import { IncomingMessage } from 'http';
import { securityConfig } from './config';
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
    return !origin || securityConfig.allowedOrigins.includes(origin);
}

export function authenticateWebSocket(req: IncomingMessage): boolean {
    if (!securityConfig.clientToken) {
        console.warn('[Security] WebSocket rejected: DISPATCHER_CLIENT_TOKEN is not configured');
        return false;
    }

    const protocols = getWebSocketProtocols(req);
    return protocols.includes(securityConfig.clientToken);
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

