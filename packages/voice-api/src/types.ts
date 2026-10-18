/**
 * Voice API Types
 */

/**
 * Transcription result from Whisper
 */
export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Language detected (ISO 639-1) */
  language?: string;
  /** Duration in seconds */
  duration?: number;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Timestamp of transcription */
  timestamp: string;
  /** Provider used (openai/replicate) */
  provider: 'openai' | 'replicate';
  /** Error message if failed */
  error?: string;
}

/**
 * Voice message from messaging platforms
 */
export interface VoiceMessage {
  /** Unique message ID */
  id: string;
  /** Platform source (telegram/line) */
  platform: 'telegram' | 'line';
  /** Chat/user ID */
  chatId: string;
  /** Audio file URL or path */
  audioUrl: string;
  /** Duration in seconds */
  duration?: number;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  fileSize?: number;
  /** Raw platform-specific data */
  raw?: unknown;
}

/**
 * Voice API configuration
 */
export interface VoiceApiConfig {
  /** OpenAI API key (for Whisper) */
  openaiApiKey?: string;
  /** Replicate API token (alternative) */
  replicateApiToken?: string;
  /** Default provider */
  provider?: 'openai' | 'replicate';
  /** Model to use */
  model?: string;
  /** Language hint (ISO 639-1) */
  language?: string;
  /** Temperature for generation */
  temperature?: number;
}

/**
 * Transcribe options
 */
export interface TranscribeOptions {
  /** Audio URL or file path (required if no audioBuffer) */
  audioUrl?: string;
  /** Audio as Buffer (Uint8Array for cross-platform) */
  audioBuffer?: Uint8Array;
  /** Language hint */
  language?: string;
  /** Model override */
  model?: string;
  /** Provider override */
  provider?: 'openai' | 'replicate';
}
