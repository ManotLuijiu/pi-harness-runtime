/**
 * Whisper Provider - Abstract interface for speech-to-text
 */
import type { TranscriptionResult, TranscribeOptions } from './types.js';
/**
 * Whisper provider interface
 */
export interface WhisperProvider {
    /** Provider name */
    name: 'openai' | 'replicate';
    /** Transcribe audio to text */
    transcribe(options: TranscribeOptions): Promise<TranscriptionResult>;
    /** Check if provider is configured */
    isConfigured(): boolean;
}
/**
 * Create OpenAI Whisper provider
 */
export declare function createOpenAIProvider(apiKey: string): WhisperProvider;
/**
 * Create Replicate Whisper provider
 */
export declare function createReplicateProvider(apiToken: string): WhisperProvider;
