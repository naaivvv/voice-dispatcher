import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

export interface TtsOptions {
    text: string;
    voiceId?: string;
    modelId?: string;
    outputFormat?: string;
    optimizeStreamingLatency?: number;
    abortSignal?: AbortSignal;
    onChunk: (chunk: Buffer) => void | Promise<void>;
}

export interface TtsConfig {
    configured: boolean;
    apiKeyConfigured: boolean;
    voiceConfigured: boolean;
    defaultVoiceId: string | null;
    modelId: string;
    outputFormat: string;
    optimizeStreamingLatency: number;
}

const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';
const DEFAULT_OUTPUT_FORMAT = 'mp3_22050_32';
const DEFAULT_OPTIMIZE_STREAMING_LATENCY = 3;

function getNumberFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function stringifyErrorBody(body: unknown): string {
    if (!body) {
        return '';
    }

    if (typeof body === 'string') {
        return body;
    }

    if (typeof body === 'object') {
        const candidate = body as {
            detail?: unknown;
            message?: unknown;
            error?: unknown;
        };

        if (typeof candidate.message === 'string') return candidate.message;
        if (typeof candidate.error === 'string') return candidate.error;

        if (candidate.detail) {
            if (typeof candidate.detail === 'string') return candidate.detail;
            if (typeof candidate.detail === 'object') {
                const detail = candidate.detail as { message?: unknown; status?: unknown };
                if (typeof detail.message === 'string') return detail.message;
                if (typeof detail.status === 'string') return detail.status;
            }
        }
    }

    try {
        return JSON.stringify(body);
    } catch {
        return '';
    }
}

export function describeTtsError(err: unknown): string {
    const error = err as {
        name?: string;
        message?: string;
        statusCode?: number;
        body?: unknown;
    };

    const status = error.statusCode ? `ElevenLabs HTTP ${error.statusCode}` : error.name;
    const body = stringifyErrorBody(error.body);
    const message = body || error.message || 'Unknown ElevenLabs TTS failure';
    const prefix = status ? `${status}: ` : '';

    return `${prefix}${message}`.slice(0, 300);
}

async function streamReadable(
    stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
    onChunk: (chunk: Buffer) => void | Promise<void>
): Promise<number> {
    let totalBytes = 0;

    if (Symbol.asyncIterator in Object(stream)) {
        for await (const chunk of stream as AsyncIterable<Uint8Array>) {
            const buffer = Buffer.from(chunk);
            totalBytes += buffer.byteLength;
            await onChunk(buffer);
        }
        return totalBytes;
    }

    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            const buffer = Buffer.from(value);
            totalBytes += buffer.byteLength;
            await onChunk(buffer);
        }
    } finally {
        reader.releaseLock();
    }

    return totalBytes;
}

class ElevenLabsTtsService {
    private readonly client: ElevenLabsClient | null;
    private readonly defaultVoiceId: string | null;
    private readonly modelId: string;
    private readonly outputFormat: string;
    private readonly optimizeStreamingLatency: number;

    constructor() {
        const apiKey = process.env.ELEVENLABS_API_KEY;

        this.defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || null;
        this.modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;
        this.outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT;
        this.optimizeStreamingLatency = getNumberFromEnv(
            'ELEVENLABS_OPTIMIZE_STREAMING_LATENCY',
            DEFAULT_OPTIMIZE_STREAMING_LATENCY
        );

        this.client = apiKey
            ? new ElevenLabsClient({
                apiKey,
                maxRetries: 2,
                timeoutInSeconds: 30,
            })
            : null;
    }

    getConfig(): TtsConfig {
        const apiKeyConfigured = Boolean(this.client);
        const voiceConfigured = Boolean(this.defaultVoiceId);

        return {
            configured: apiKeyConfigured && voiceConfigured,
            apiKeyConfigured,
            voiceConfigured,
            defaultVoiceId: this.defaultVoiceId,
            modelId: this.modelId,
            outputFormat: this.outputFormat,
            optimizeStreamingLatency: this.optimizeStreamingLatency,
        };
    }

    async streamSpeech(options: TtsOptions): Promise<number> {
        if (!this.client) {
            throw new Error('ELEVENLABS_API_KEY is not configured');
        }

        const voiceId = options.voiceId || this.defaultVoiceId;
        if (!voiceId) {
            throw new Error('ELEVENLABS_VOICE_ID is not configured');
        }

        const text = options.text.trim();
        if (!text) {
            throw new Error('Cannot synthesize empty dispatcher text');
        }

        const stream = await this.client.textToSpeech.stream(
            voiceId,
            {
                text,
                modelId: options.modelId || this.modelId,
                outputFormat: (options.outputFormat || this.outputFormat) as any,
                optimizeStreamingLatency:
                    options.optimizeStreamingLatency ?? this.optimizeStreamingLatency,
                voiceSettings: {
                    stability: 0.48,
                    similarityBoost: 0.82,
                    style: 0.15,
                    useSpeakerBoost: false,
                    speed: 1.03,
                },
            },
            {
                maxRetries: 2,
                timeoutInSeconds: 30,
                abortSignal: options.abortSignal,
            }
        );

        return streamReadable(stream as AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>, options.onChunk);
    }
}

export const elevenLabsTts = new ElevenLabsTtsService();
