/**
 * Whisper Provider - Abstract interface for speech-to-text
 */
/**
 * Create OpenAI Whisper provider
 */
export function createOpenAIProvider(apiKey) {
    return new OpenAIProvider(apiKey);
}
/**
 * Create Replicate Whisper provider
 */
export function createReplicateProvider(apiToken) {
    return new ReplicateProvider(apiToken);
}
/**
 * OpenAI Whisper Provider
 */
class OpenAIProvider {
    name = 'openai';
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    isConfigured() {
        return Boolean(this.apiKey);
    }
    async transcribe(options) {
        const startTime = Date.now();
        try {
            // Dynamic import to avoid hard dependency
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({ apiKey: this.apiKey });
            let audioData;
            if (options.audioBuffer) {
                audioData = Buffer.from(options.audioBuffer);
            }
            else if (options.audioUrl) {
                // Fetch audio from URL
                const response = await fetch(options.audioUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch audio: ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                audioData = Buffer.from(arrayBuffer);
            }
            else {
                throw new Error('No audio data provided');
            }
            const result = await openai.audio.transcriptions.create({
                file: audioData,
                model: options.model || 'whisper-1',
                language: options.language,
                response_format: 'verbose_json',
            });
            return {
                text: result.text,
                language: result.language || options.language,
                duration: result.duration,
                timestamp: new Date().toISOString(),
                provider: 'openai',
            };
        }
        catch (error) {
            return {
                text: '',
                timestamp: new Date().toISOString(),
                provider: 'openai',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
/**
 * Replicate Whisper Provider
 */
class ReplicateProvider {
    name = 'replicate';
    apiToken;
    constructor(apiToken) {
        this.apiToken = apiToken;
    }
    isConfigured() {
        return Boolean(this.apiToken);
    }
    async transcribe(options) {
        const startTime = Date.now();
        try {
            // Get audio data
            let audioData;
            if (options.audioBuffer) {
                audioData = options.audioBuffer;
            }
            else if (options.audioUrl) {
                const response = await fetch(options.audioUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch audio: ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                audioData = new Uint8Array(arrayBuffer);
            }
            else {
                throw new Error('No audio data provided');
            }
            // Convert to base64 for Replicate
            const base64 = btoa(String.fromCharCode(...audioData));
            const dataUrl = `data:audio/wav;base64,${base64}`;
            // Call Replicate API
            const response = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    version: 'e39e7d2f3c2b7a7d8c9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
                    input: {
                        audio: dataUrl,
                        model: options.model || 'large-v3',
                    },
                }),
            });
            if (!response.ok) {
                throw new Error(`Replicate API error: ${response.status}`);
            }
            const prediction = await response.json();
            // Poll for completion
            let result = prediction;
            while (result.status !== 'succeeded' && result.status !== 'failed') {
                await new Promise(r => setTimeout(r, 1000));
                const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
                    headers: { 'Authorization': `Token ${this.apiToken}` },
                });
                result = await pollResponse.json();
            }
            if (result.status === 'failed') {
                throw new Error(result.error || 'Transcription failed');
            }
            return {
                text: result.output,
                timestamp: new Date().toISOString(),
                provider: 'replicate',
            };
        }
        catch (error) {
            return {
                text: '',
                timestamp: new Date().toISOString(),
                provider: 'replicate',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
