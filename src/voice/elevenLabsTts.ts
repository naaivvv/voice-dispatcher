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
        return {
            configured: Boolean(this.client && this.defaultVoiceId),
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

        let totalBytes = 0;

        for await (const chunk of stream as AsyncIterable<Uint8Array>) {
            const buffer = Buffer.from(chunk);
            totalBytes += buffer.byteLength;
            await options.onChunk(buffer);
        }

        return totalBytes;
    }
}

export const elevenLabsTts = new ElevenLabsTtsService();
