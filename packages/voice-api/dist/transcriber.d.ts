/**
 * Voice Transcriber - Main interface for speech-to-text
 */
import type { TranscriptionResult, TranscribeOptions, VoiceApiConfig } from './types.js';
import { WhisperProvider } from './provider.js';
/**
 * Voice Transcriber
 *
 * Main interface for transcribing voice messages to text.
 * Supports multiple providers (OpenAI, Replicate).
 */
export declare class VoiceTranscriber {
    private providers;
    private defaultProvider;
    constructor(config?: VoiceApiConfig);
    /**
     * Check if transcriber is configured
     */
    isConfigured(): boolean;
    /**
     * Get configured providers
     */
    getProviders(): string[];
    /**
     * Get default provider
     */
    getDefaultProvider(): string | null;
    /**
     * Transcribe audio to text
     */
    transcribe(options: TranscribeOptions): Promise<TranscriptionResult>;
    /**
     * Add a provider
     */
    addProvider(name: string, provider: WhisperProvider): void;
    /**
     * Remove a provider
     */
    removeProvider(name: string): boolean;
    /**
     * Set default provider
     */
    setDefaultProvider(name: string): boolean;
}
/**
 * Create a VoiceTranscriber from environment variables
 */
export declare function createFromEnv(): VoiceTranscriber;
