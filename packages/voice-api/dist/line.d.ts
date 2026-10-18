/**
 * LINE Voice Handler
 *
 * Handles voice messages from LINE Messaging API.
 */
import type { TranscriptionResult } from './types.js';
import { VoiceTranscriber } from './transcriber.js';
/**
 * LINE webhook event
 */
export interface LineWebhookEvent {
    type: string;
    timestamp: number;
    source: {
        type: string;
        userId?: string;
        groupId?: string;
        roomId?: string;
    };
    replyToken?: string;
    message?: {
        id: string;
        type: string;
        duration?: number;
    };
}
/**
 * LINE webhook body
 */
export interface LineWebhookBody {
    destination: string;
    events: LineWebhookEvent[];
}
/**
 * LINE Voice Handler options
 */
export interface LineVoiceHandlerOptions {
    /** LINE channel access token */
    channelAccessToken: string;
    /** LINE user ID secret (for validation) */
    channelSecret?: string;
    /** Voice transcriber instance */
    transcriber: VoiceTranscriber;
    /** Base URL for LINE API */
    apiBase?: string;
    /** Callback when voice is transcribed */
    onTranscribed?: (userId: string, text: string, result: TranscriptionResult) => Promise<void>;
    /** Callback on error */
    onError?: (userId: string, error: Error) => void;
}
/**
 * LINE Voice Handler
 *
 * Processes voice messages from LINE Messaging API and transcribes them.
 */
export declare class LineVoiceHandler {
    private channelAccessToken;
    private channelSecret?;
    private transcriber;
    private apiBase;
    private dataApiBase;
    private onTranscribed?;
    private onError?;
    constructor(options: LineVoiceHandlerOptions);
    /**
     * Verify LINE webhook signature
     */
    verifySignature(_body: string, _signature: string): boolean;
    /**
     * Handle incoming webhook from LINE
     */
    handleWebhook(body: LineWebhookBody): Promise<{
        success: boolean;
        responses: string[];
    }>;
    /**
     * Get audio content from LINE
     */
    private getAudioContent;
    /**
     * Reply to user with text
     */
    reply(replyToken: string, messages: Array<{
        type: string;
        text?: string;
    }>): Promise<boolean>;
    /**
     * Push message to user
     */
    push(userId: string, messages: Array<{
        type: string;
        text?: string;
    }>): Promise<boolean>;
    /**
     * Create webhook handler for Express/Fastify/etc.
     */
    createWebhookHandler(): (body: LineWebhookBody, headers: Record<string, string>) => Promise<{
        status: number;
        body: object;
    }>;
}
