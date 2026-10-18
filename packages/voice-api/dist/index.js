/**
 * Voice API - Speech-to-Text using Whisper
 *
 * Supports:
 * - OpenAI Whisper API (primary)
 * - Replicate Whisper (alternative)
 *
 * Used by Telegram and LINE voice message handlers.
 */
export { VoiceTranscriber } from './transcriber.js';
export { TelegramVoiceHandler } from './telegram.js';
export { LineVoiceHandler } from './line.js';
