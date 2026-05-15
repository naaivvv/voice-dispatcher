import { NextFunction, Request, Response } from 'express';
import { normalizeOrigin, securityConfig } from './config';
import { FixedWindowRateLimiter } from './rateLimiter';

const bearerPrefix = 'Bearer ';
const httpLimiter = new FixedWindowRateLimiter(
    securityConfig.httpRateLimitWindowMs,
    securityConfig.httpRateLimitMax
);

export function getClientIp(req: Request): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.ip || req.socket.remoteAddress || 'unknown';
}

export function getHttpClientToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith(bearerPrefix)) {
        return auth.slice(bearerPrefix.length).trim();
    }

    const headerToken = req.headers['x-dispatcher-client-token'];
    return typeof headerToken === 'string' ? headerToken.trim() : null;
}

export function requireClientToken(req: Request, res: Response, next: NextFunction): void {
    if (!securityConfig.clientToken) {
        console.warn('[Security] Protected route requested, but DISPATCHER_CLIENT_TOKEN is not configured');
        res.status(503).json({ error: 'Service is not configured for authenticated access' });
        return;
    }

    const token = getHttpClientToken(req);
    if (token !== securityConfig.clientToken) {
        console.warn(`[Security] Rejected HTTP auth for ${req.method} ${req.path} from ${getClientIp(req)}`);
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
}

export function rateLimitHttp(req: Request, res: Response, next: NextFunction): void {
    const token = getHttpClientToken(req);
    const identity = token ? `token:${token}` : `ip:${getClientIp(req)}`;
    const result = httpLimiter.consume(identity);

    if (!result.allowed) {
        console.warn(`[Security] HTTP rate limit exceeded for ${identity} on ${req.method} ${req.path}`);
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        res.status(429).json({ error: 'Too many requests' });
        return;
    }

    next();
}

export function enforceAllowedOrigin(req: Request, res: Response, next: NextFunction): void {
    if (securityConfig.allowedOrigins.length === 0) {
        next();
        return;
    }

    const origin = req.headers.origin;
    const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
    if (!normalizedOrigin || securityConfig.allowedOrigins.includes(normalizedOrigin)) {
        if (normalizedOrigin) {
            res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
            res.setHeader('Vary', 'Origin');
        }
        next();
        return;
    }

    console.warn(`[Security] Rejected HTTP origin ${origin} for ${req.method} ${req.path}`);
    res.status(403).json({ error: 'Forbidden' });
}
