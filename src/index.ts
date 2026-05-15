import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import path from 'path';
import { elevenLabsTts } from './voice';
import { createWebSocketServer, sessionManager } from './websocket';
import {
    enforceAllowedOrigin,
    rateLimitHttp,
    requireClientToken,
    securityConfig,
} from './security';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(enforceAllowedOrigin);
app.use(express.json({ limit: securityConfig.wsMaxJsonBytes }));
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// ── Health check ───────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: process.uptime(),
        activeSessions: sessionManager.activeCount,
        providers: {
            ttsConfigured: elevenLabsTts.getConfig().configured,
            wsAuth: 'supabase_access_token',
            adminClientAuthConfigured: Boolean(securityConfig.clientToken),
        },
    });
});

// ── Active sessions monitor ────────────────────────────────
app.get('/sessions', rateLimitHttp, requireClientToken, (_req, res) => {
    res.json({
        count: sessionManager.activeCount,
        sessions: sessionManager.getActiveSessions(),
    });
});

// ── Create HTTP server and attach WebSocket ────────────────
const httpServer = createServer(app);
createWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
    console.log(`[voice-dispatcher] HTTP  server → http://localhost:${PORT}`);
    console.log(`[voice-dispatcher] WS    server → ws://localhost:${PORT}/ws/call`);
    console.log(`[voice-dispatcher] Health check  → http://localhost:${PORT}/health`);
    console.log(`[voice-dispatcher] Sessions      → http://localhost:${PORT}/sessions`);
});

export default app;
