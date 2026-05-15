# Voice Dispatcher: Frontend Integration & System Context

This document outlines the architecture, data models, and integration protocols for the Voice Dispatcher backend service. It serves as the primary context document for developing any new client applications (web or mobile) that will interact with this service.

## 1. System Overview

The Voice Dispatcher is a real-time, stateful AI backend designed for logistics, delivery, and non-emergency transport operations. It allows drivers to call in, report status updates, update their Estimated Time of Arrival (ETA), and ask for delivery details using natural voice conversation.

### Tech Stack
- **Runtime Environment:** Node.js with TypeScript
- **Network Protocol:** HTTP/HTTPS and WebSockets (`ws`)
- **Database:** Supabase (PostgreSQL)
- **AI Orchestration:** LangChain with Groq (e.g., `llama3-70b-8192` model)
- **Text-to-Speech (TTS):** ElevenLabs API

### Core Features
- **Real-time Voice Communication:** Maintains persistent WebSocket connections for low-latency audio streaming.
- **Contextual Memory:** Uses LangChain to remember driver details and current deliveries throughout the call session.
- **Operational Mutability:** Automatically extracts intents from driver speech to update database records (e.g., changing ETAs or marking deliveries complete).
- **Audit Logging:** Every AI-driven state mutation is logged for traceability.

---

## 2. Database Context

The backend uses a Supabase PostgreSQL database with Row Level Security (RLS) enabled. Public API access is blocked; the backend interacts with the database securely via a Service Role Key.

### Core Entities
1. **`drivers`**: Represents delivery personnel.
   - Key fields: `id`, `name`, `phone_number` (E.164 format, used for authentication), `status` ('active', 'on_break', 'delayed').
2. **`deliveries`**: Represents assigned tasks.
   - Key fields: `id`, `driver_id`, `destination`, `scheduled_time`, `estimated_arrival` (updated by AI), `status` ('pending', 'in_transit', 'completed', 'cancelled').
3. **`dispatch_audit_log`**: Traceability table.
   - Records every action the AI takes (e.g., `update_eta`, `complete_delivery`), including old and new values.

---

## 3. Frontend Integration Guide

To build a frontend client (like a mobile app or a driver dashboard), you will primarily interact with the backend via **WebSockets**.

### Connection Setup

The backend is deployed to Render with Service ID **`srv-d82lhfjeo5us73f8ron0`**.
Your WebSocket connection URL is: `wss://voice-dispatcher.onrender.com/ws/call`.
Your HTTP API URL is: `https://voice-dispatcher.onrender.com`.

#### Authentication
The WebSocket endpoint is secured using the user's **Supabase access token** via WebSocket subprotocols. When establishing the connection, the frontend **MUST** pass two protocol strings:
1. `'voice-dispatcher'` (the required application protocol)
2. The logged-in user's Supabase `session.access_token`

The backend validates this token with Supabase before accepting the socket, then verifies that `call.start.phone_number` belongs to the authenticated driver.

**Example JavaScript Connection:**
```javascript
const wsUrl = 'wss://voice-dispatcher.onrender.com/ws/call';
const { data } = await supabase.auth.getSession();
const accessToken = data.session?.access_token;

const ws = new WebSocket(wsUrl, ['voice-dispatcher', accessToken]);
```

### The Communication Lifecycle

Communication happens via JSON-formatted text messages over the WebSocket connection. (Binary frames are reserved for future raw audio streaming).

#### Step 1: Starting the Call
Once the WebSocket connection opens, the frontend must immediately identify the driver using their phone number (which must exist in the `drivers` table).

**Frontend sends:**
```json
{
  "type": "call.start",
  "phone_number": "+15551234567"
}
```

**Backend responds:**
```json
{
  "type": "session.created",
  "session_id": "uuid-...",
  "driver": { "id": "...", "name": "Carlos Rivera", "status": "active" }
}
```
*Followed immediately by a `session.ready` event indicating context is loaded.*

#### Step 2: Sending Driver Speech (Transcriptions)
Currently, the client is responsible for capturing audio, converting it to text (e.g., using Web Speech API or a native STT module), and sending the transcription to the backend.

**Frontend sends:**
```json
{
  "type": "driver.transcription",
  "text": "I'm stuck in traffic, I'll be 20 minutes late to my next stop."
}
```

#### Step 3: Handling Agent Responses
When the backend processes the transcription, it will emit several events to update the UI and play audio.

1. **`agent.thinking`**: Fired immediately when LangChain starts processing. Show a loading indicator.
2. **`action.executed`**: (Optional) Fired if the AI decided to mutate the database.
   ```json
   {
     "type": "action.executed",
     "tool": "update_eta",
     "result": "ETA updated successfully to 2:45 PM"
   }
   ```
3. **`agent.response`**: Contains the final text response and classified intent.
   ```json
   {
     "type": "agent.response",
     "text": "I've updated your ETA for the Springfield delivery. Drive safe.",
     "intent": "update_eta"
   }
   ```
4. **`audio.output.start`** & **`audio.output.done`**: Wraps the binary audio data transmission. Between these events, the backend will send raw binary WebSocket frames containing the generated TTS audio (default: MP3 format). The frontend should append these binary frames to a MediaSource or AudioContext buffer to play them.

#### Step 4: Interruptions
If the driver starts speaking while the AI is currently talking (TTS streaming), the frontend should send an interrupt signal. This immediately halts the backend TTS stream.

**Frontend sends:**
```json
{
  "type": "driver.interrupt"
}
```

#### Step 5: Ending the Call
**Frontend sends:**
```json
{
  "type": "call.end"
}
```

---

## 4. Production Deployment Setup (Render)

If the backend is hosted on Render, the following configurations must be mirrored on both the Render Dashboard and your new Frontend environment.

### Backend Configurations (Render Environment Variables)
- `PORT`: Set automatically by Render.
- `ALLOWED_ORIGINS`: Set this to the URL of your new frontend application (e.g., `https://my-driver-app.vercel.app`).
- `DISPATCHER_CLIENT_TOKEN`: Keep this only for protected HTTP admin routes such as `/sessions`; it is no longer used by the browser WebSocket client.
- `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`: Your database credentials.
- `GROQ_API_KEY`: For LangChain/LLM logic.
- `ELEVENLABS_API_KEY`: For Text-to-Speech generation.

### Frontend Requirements
- When deploying the frontend, ensure it connects using `wss://` (secure WebSockets) rather than `ws://`. 
- `VITE_WS_URL`: Set to `wss://voice-dispatcher.onrender.com/ws/call`.
- The frontend must authenticate users with the same Supabase project used by the backend.
- Ensure your frontend is served via HTTPS, as many browser-based microphone/speech recognition APIs require a secure context to function.
