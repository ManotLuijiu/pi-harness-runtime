/**
 * OpenAI Whisper API Transcription
 *
 * Transcribes audio using OpenAI's Whisper API.
 */
import type { TranscriptionResult } from './types.js';
export interface TranscriberOptions {
    openaiApiKey: string;
    model?: string;
}
export declare class VoiceTranscriber {
    private apiKey;
    private model;
    constructor(options: TranscriberOptions);
    /**
     * Transcribe audio buffer using Whisper API
     */
    transcribe(audioBuffer: Uint8Array): Promise<TranscriptionResult>;
}
