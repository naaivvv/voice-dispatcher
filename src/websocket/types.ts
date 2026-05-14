// ============================================================
// WebSocket message protocol types
// ============================================================

/**
 * Messages sent FROM the client (driver/simulator) TO the server.
 */
export type ClientMessage =
    | { type: 'call.start'; phone_number: string }
    | {
        type: 'dispatcher.speak';
        text: string;
        voice_id?: string;
        model_id?: string;
        output_format?: string;
    }
    | { type: 'call.end' }
    | { type: 'audio.chunk' };  // Binary frames are sent separately

/**
 * Messages sent FROM the server TO the client.
 */
export type ServerMessage =
    | { type: 'session.created'; session_id: string; driver: { id: string; name: string; status: string } }
    | { type: 'session.ready'; message: string }
    | { type: 'agent.thinking' }
    | { type: 'agent.speaking'; text: string }
    | {
        type: 'audio.output.start';
        format: string;
        sample_rate: number;
        voice_id: string | null;
        text: string;
    }
    | { type: 'audio.output.done'; bytes: number }
    | { type: 'agent.done' }
    | { type: 'session.ended'; reason: string }
    | { type: 'error'; message: string };

/**
 * Audio configuration for the streaming pipeline.
 * ElevenLabs expects specific formats — we define them once here.
 */
export const AUDIO_CONFIG = {
    /** Sample rate for input audio (from driver's mic) */
    inputSampleRate: 16000,
    /** Sample rate for output audio (ElevenLabs TTS) */
    outputSampleRate: 22050,
    /** Encoded output format for TTS responses */
    outputFormat: 'mp3_22050_32',
    /** Audio encoding for input */
    inputEncoding: 'pcm_s16le' as const,
    /** Channels */
    channels: 1,
    /** How often we flush the audio buffer (ms) */
    bufferFlushInterval: 250,
};
