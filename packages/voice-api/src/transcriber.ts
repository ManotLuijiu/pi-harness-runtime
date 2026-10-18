/**
 * Voice Transcriber - Main interface for speech-to-text
 */

import type { TranscriptionResult, TranscribeOptions, VoiceApiConfig } from './types.js';
import { WhisperProvider, createOpenAIProvider, createReplicateProvider } from './provider.js';

/**
 * Voice Transcriber
 * 
 * Main interface for transcribing voice messages to text.
 * Supports multiple providers (OpenAI, Replicate).
 */
export class VoiceTranscriber {
  private providers: Map<string, WhisperProvider> = new Map();
  private defaultProvider: string = '';

  constructor(config: VoiceApiConfig = {}) {
    // Initialize OpenAI provider
    if (config.openaiApiKey) {
      const provider = createOpenAIProvider(config.openaiApiKey);
      this.providers.set('openai', provider);
      this.defaultProvider = 'openai';
    }

    // Initialize Replicate provider
    if (config.replicateApiToken) {
      const provider = createReplicateProvider(config.replicateApiToken);
      this.providers.set('replicate', provider);
      if (!this.defaultProvider) {
        this.defaultProvider = 'replicate';
      }
    }

    // Set default provider from config
    if (config.provider && this.providers.has(config.provider)) {
      this.defaultProvider = config.provider;
    }
  }

  /**
   * Check if transcriber is configured
   */
  isConfigured(): boolean {
    return this.providers.size > 0;
  }

  /**
   * Get configured providers
   */
  getProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get default provider
   */
  getDefaultProvider(): string | null {
    return this.defaultProvider || null;
  }

  /**
   * Transcribe audio to text
   */
  async transcribe(options: TranscribeOptions): Promise<TranscriptionResult> {
    const providerName = options.provider || this.defaultProvider;
    
    if (!providerName) {
      return {
        text: '',
        timestamp: new Date().toISOString(),
        provider: 'openai',
        error: 'No provider configured',
      };
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      return {
        text: '',
        timestamp: new Date().toISOString(),
        provider: providerName as 'openai' | 'replicate',
        error: `Provider ${providerName} not configured`,
      };
    }

    return provider.transcribe(options);
  }

  /**
   * Add a provider
   */
  addProvider(name: string, provider: WhisperProvider): void {
    this.providers.set(name, provider);
    if (!this.defaultProvider) {
      this.defaultProvider = name;
    }
  }

  /**
   * Remove a provider
   */
  removeProvider(name: string): boolean {
    const deleted = this.providers.delete(name);
    if (this.defaultProvider === name) {
      this.defaultProvider = this.providers.keys().next().value || '';
    }
    return deleted;
  }

  /**
   * Set default provider
   */
  setDefaultProvider(name: string): boolean {
    if (this.providers.has(name)) {
      this.defaultProvider = name;
      return true;
    }
    return false;
  }
}

/**
 * Create a VoiceTranscriber from environment variables
 */
export function createFromEnv(): VoiceTranscriber {
  // SAFETY: globalThis.process is always available in Node.js
  const env = (globalThis as unknown as { process: { env: Record<string, string> } }).process;
  const envVars = env?.env ?? {};
  
  return new VoiceTranscriber({
    openaiApiKey: envVars.OPENAI_API_KEY,
    replicateApiToken: envVars.REPLICATE_API_TOKEN,
    provider: (envVars.VOICE_PROVIDER as 'openai' | 'replicate') || 'openai',
  });
}
