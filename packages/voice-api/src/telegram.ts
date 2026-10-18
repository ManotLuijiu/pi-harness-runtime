/**
 * Telegram Voice Handler
 * 
 * Handles voice messages from Telegram bots.
 */

import type { VoiceMessage, TranscriptionResult } from './types.js';
import { VoiceTranscriber } from './transcriber.js';

/**
 * Telegram voice message from bot update
 */
export interface TelegramVoiceUpdate {
  update_id: number;
  message?: {
    message_id: number;
    voice?: {
      file_id: string;
      duration: number;
      mime_type: string;
      file_size?: number;
    };
    chat: {
      id: number;
      type: string;
    };
  };
}

/**
 * Telegram API response
 */
interface TelegramFileResponse {
  ok: boolean;
  result?: {
    file_id: string;
    file_unique_id: string;
    file_path: string;
  };
  description?: string;
}

/**
 * Telegram Voice Handler options
 */
export interface TelegramVoiceHandlerOptions {
  /** Telegram bot token */
  botToken: string;
  /** Voice transcriber instance */
  transcriber: VoiceTranscriber;
  /** Base URL for Telegram API */
  apiBase?: string;
  /** Callback when voice is transcribed */
  onTranscribed?: (chatId: string, text: string, result: TranscriptionResult) => Promise<void>;
  /** Callback on error */
  onError?: (chatId: string, error: Error) => void;
}

/**
 * Telegram Voice Handler
 * 
 * Processes voice messages from Telegram and transcribes them.
 */
export class TelegramVoiceHandler {
  private botToken: string;
  private transcriber: VoiceTranscriber;
  private apiBase: string;
  private onTranscribed?: (chatId: string, text: string, result: TranscriptionResult) => Promise<void>;
  private onError?: (chatId: string, error: Error) => void;

  constructor(options: TelegramVoiceHandlerOptions) {
    this.botToken = options.botToken;
    this.transcriber = options.transcriber;
    this.apiBase = options.apiBase || 'https://api.telegram.org';
    this.onTranscribed = options.onTranscribed;
    this.onError = options.onError;
  }

  /**
   * Handle incoming update from Telegram webhook
   */
  async handleUpdate(update: TelegramVoiceUpdate): Promise<{ success: boolean; text?: string; error?: string }> {
    const message = update.message;
    const voice = message?.voice;

    if (!message || !voice) {
      return { success: false, error: 'No voice message in update' };
    }

    const chatId = String(message.chat.id);

    try {
      // Get file path from Telegram
      const filePath = await this.getFilePath(voice.file_id);
      if (!filePath) {
        return { success: false, error: 'Failed to get file path' };
      }

      // Construct download URL
      const fileUrl = `${this.apiBase}/file/bot${this.botToken}/${filePath}`;

      // Transcribe
      const result = await this.transcriber.transcribe({ audioUrl: fileUrl });

      if (result.error) {
        this.onError?.(chatId, new Error(result.error));
        return { success: false, error: result.error };
      }

      // Notify callback
      await this.onTranscribed?.(chatId, result.text, result);

      return { success: true, text: result.text };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError?.(chatId, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get file path from Telegram
   */
  private async getFilePath(fileId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.apiBase}/bot${this.botToken}/getFile?file_id=${fileId}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as TelegramFileResponse;
      return data.result?.file_path || null;
    } catch {
      return null;
    }
  }

  /**
   * Send text response to chat
   */
  async sendMessage(chatId: string, text: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiBase}/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
          }),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create webhook handler middleware
   */
  createWebhookHandler() {
    return async (request: Request): Promise<Response> => {
      try {
        const update = await request.json() as TelegramVoiceUpdate;
        const result = await this.handleUpdate(update);

        if (result.success && result.text) {
          // Optionally echo back the transcription
          // await this.sendMessage(String(update.message?.chat.id), `🎤: ${result.text}`);
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    };
  }
}
