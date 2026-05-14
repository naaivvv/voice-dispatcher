import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { elevenLabsTts } from './voice';
import { createWebSocketServer, sessionManager } from './websocket';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Health check ───────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeSessions: sessionManager.activeCount,
        tts: elevenLabsTts.getConfig(),
    });
});

// ── Active sessions monitor ────────────────────────────────
app.get('/sessions', (_req, res) => {
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
