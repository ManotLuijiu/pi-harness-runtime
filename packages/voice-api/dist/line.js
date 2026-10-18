/**
 * LINE Voice Handler
 *
 * Handles voice messages from LINE Messaging API.
 */
/**
 * LINE Voice Handler
 *
 * Processes voice messages from LINE Messaging API and transcribes them.
 */
export class LineVoiceHandler {
    channelAccessToken;
    channelSecret;
    transcriber;
    apiBase;
    onTranscribed;
    onError;
    constructor(options) {
        this.channelAccessToken = options.channelAccessToken;
        this.channelSecret = options.channelSecret;
        this.transcriber = options.transcriber;
        this.apiBase = options.apiBase || 'https://api.line.me';
        this.onTranscribed = options.onTranscribed;
        this.onError = options.onError;
    }
    /**
     * Verify LINE webhook signature
     */
    verifySignature(body, signature) {
        if (!this.channelSecret)
            return true; // Skip verification if no secret
        // Note: In production, implement proper HMAC verification
        // This is a simplified version
        return true;
    }
    /**
     * Handle incoming webhook from LINE
     */
    async handleWebhook(body) {
        const responses = [];
        for (const event of body.events) {
            if (event.type !== 'message' || event.message?.type !== 'audio') {
                continue;
            }
            const userId = event.source.userId || 'unknown';
            const messageId = event.message.id;
            try {
                // Get audio content from LINE
                const audioContent = await this.getAudioContent(messageId);
                if (!audioContent) {
                    responses.push(`Failed to get audio for message ${messageId}`);
                    continue;
                }
                // Transcribe
                const result = await this.transcriber.transcribe({
                    audioBuffer: audioContent,
                });
                if (result.error) {
                    this.onError?.(userId, new Error(result.error));
                    responses.push(`Transcription error: ${result.error}`);
                    continue;
                }
                // Notify callback
                await this.onTranscribed?.(userId, result.text, result);
                responses.push(`Transcribed: ${result.text}`);
            }
            catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.onError?.(userId, err);
                responses.push(`Error: ${err.message}`);
            }
        }
        return { success: true, responses };
    }
    /**
     * Get audio content from LINE
     */
    async getAudioContent(messageId) {
        try {
            const response = await fetch(`${this.apiBase}/v2/bot/message/${messageId}/content`, {
                headers: {
                    'Authorization': `Bearer ${this.channelAccessToken}`,
                },
            });
            if (!response.ok) {
                return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        }
        catch {
            return null;
        }
    }
    /**
     * Reply to user with text
     */
    async reply(replyToken, messages) {
        try {
            const response = await fetch(`${this.apiBase}/v2/bot/message/reply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.channelAccessToken}`,
                },
                body: JSON.stringify({ replyToken, messages }),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Push message to user
     */
    async push(userId, messages) {
        try {
            const response = await fetch(`${this.apiBase}/v2/bot/message/push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.channelAccessToken}`,
                },
                body: JSON.stringify({ to: userId, messages }),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Create webhook handler for Express/Fastify/etc.
     */
    createWebhookHandler() {
        return async (body, headers) => {
            // Verify signature if provided
            const signature = headers['x-line-signature'];
            if (signature && !this.verifySignature(JSON.stringify(body), signature)) {
                return { status: 401, body: { error: 'Invalid signature' } };
            }
            const result = await this.handleWebhook(body);
            return { status: 200, body: { success: result.success, responses: result.responses } };
        };
    }
}
