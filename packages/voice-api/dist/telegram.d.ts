/**
 * Telegram Voice Handler
 *
 * Handles voice messages from Telegram bots.
 */
import type { TranscriptionResult } from './types.js';
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
export declare class TelegramVoiceHandler {
    private botToken;
    private transcriber;
    private apiBase;
    private onTranscribed?;
    private onError?;
    constructor(options: TelegramVoiceHandlerOptions);
    /**
     * Handle incoming update from Telegram webhook
     */
    handleUpdate(update: TelegramVoiceUpdate): Promise<{
        success: boolean;
        text?: string;
        error?: string;
    }>;
    /**
     * Get file path from Telegram
     */
    private getFilePath;
    /**
     * Send text response to chat
     */
    sendMessage(chatId: string, text: string): Promise<boolean>;
    /**
     * Create webhook handler middleware
     */
    createWebhookHandler(): (request: Request) => Promise<Response>;
}
