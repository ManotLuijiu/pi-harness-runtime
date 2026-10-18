/**
 * OpenAI Whisper API Transcription
 * 
 * Transcribes audio using OpenAI's Whisper API.
 */

import type { TranscriptionResult } from './types.js';
import * as https from "https";

export interface TranscriberOptions {
  openaiApiKey: string;
  model?: string;
}

export class VoiceTranscriber {
  private apiKey: string;
  private model: string;

  constructor(options: TranscriberOptions) {
    this.apiKey = options.openaiApiKey;
    this.model = options.model || "whisper-1";
  }

  /**
   * Transcribe audio buffer using Whisper API
   */
  async transcribe(audioBuffer: Uint8Array): Promise<TranscriptionResult> {
    return new Promise((resolve) => {
      const boundary = "----FormBoundary" + Math.random().toString(36).substring(2);
      
      // Build multipart form data
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.m4a"\r\n`),
        Buffer.from(`Content-Type: audio/x-m4a\r\n\r\n`),
        Buffer.from(audioBuffer),
        Buffer.from(`\r\n--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`),
        Buffer.from(`${this.model}\r\n`),
        Buffer.from(`--${boundary}--\r\n`),
      ]);
      
      const options = {
        hostname: "api.openai.com",
        path: "/v1/audio/transcriptions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
        }
      };
      
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          if (res.statusCode !== 200) {
            try {
              const error = JSON.parse(data);
              resolve({ 
                text: "", 
                timestamp: new Date().toISOString(),
                provider: 'openai' as const,
                error: error.error?.message || data 
              });
            } catch {
              resolve({ 
                text: "", 
                timestamp: new Date().toISOString(),
                provider: 'openai' as const,
                error: data 
              });
            }
            return;
          }
          
          try {
            const result = JSON.parse(data);
            resolve({
              text: result.text || "",
              language: result.language,
              duration: result.duration,
              confidence: result.confidence,
              timestamp: new Date().toISOString(),
              provider: 'openai' as const,
            });
          } catch (e) {
            resolve({ 
              text: "", 
              timestamp: new Date().toISOString(),
              provider: 'openai' as const,
              error: String(e) 
            });
          }
        });
      });
      
      req.on("error", (err) => {
        resolve({ 
          text: "", 
          timestamp: new Date().toISOString(),
          provider: 'openai' as const,
          error: String(err) 
        });
      });
      
      req.write(body);
      req.end();
    });
  }
}
