/**
 * Voice API Example - Telegram Voice to Command
 * 
 * This script demonstrates how to:
 * 1. Receive voice message from Telegram
 * 2. Transcribe with Whisper API
 * 3. Execute as pi-harness command
 * 
 * Run:
 *   OPENAI_API_KEY=sk-xxx bun run scripts/voice-api-example.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { VoiceTranscriber } from "../packages/voice-api/dist/transcriber.js";
import { TelegramVoiceHandler } from "../packages/voice-api/dist/telegram.js";

// Load API keys from key files
function loadKey(filename: string): string | null {
  const keysDir = path.join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "keys");
  const filepath = path.join(keysDir, filename);
  try {
    return fs.readFileSync(filepath, "utf8").trim();
  } catch {
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Voice API Example - Telegram Voice to Command");
  console.log("=".repeat(60));

  // Load API keys
  const openaiApiKey = process.env.OPENAI_API_KEY || loadKey("openai-api-key.txt");
  const telegramBotToken = loadKey("telegram-bot-token.txt");

  if (!openaiApiKey) {
    console.log("❌ OpenAI API key not found");
    console.log("   Set OPENAI_API_KEY or create ~/.pi-harness-runtime/keys/openai-api-key.txt");
    process.exit(1);
  }

  console.log("✓ OpenAI API key loaded");

  // Create transcriber
  const transcriber = new VoiceTranscriber({ openaiApiKey });
  console.log("✓ VoiceTranscriber created");

  if (!transcriber.isConfigured()) {
    console.log("❌ Transcriber not configured");
    process.exit(1);
  }

  console.log(`✓ Providers: ${transcriber.getProviders().join(", ")}`);
  console.log(`✓ Default: ${transcriber.getDefaultProvider()}`);

  // If Telegram token provided, create handler
  if (telegramBotToken) {
    console.log("✓ Telegram bot token loaded");

    const handler = new TelegramVoiceHandler({
      botToken: telegramBotToken,
      transcriber,
      onTranscribed: async (chatId, text, result) => {
        console.log("\n" + "=".repeat(60));
        console.log("Voice transcribed:");
        console.log(`  Chat: ${chatId}`);
        console.log(`  Text: ${text}`);
        console.log(`  Provider: ${result.provider}`);
        console.log(`  Language: ${result.language || "auto"}`);
        console.log("=".repeat(60));
        
        // Here you would execute the command in pi-harness
        console.log("\n[pi-harness] Would execute:");
        console.log(`  ${text}`);
      },
      onError: (chatId, error) => {
        console.log(`❌ Error for chat ${chatId}: ${error.message}`);
      },
    });

    console.log("✓ TelegramVoiceHandler created");
    console.log("\nListening for Telegram voice messages...");
    console.log("(This is a demo - actual webhook server not started)");
  } else {
    console.log("⚠ Telegram bot token not found");
    console.log("   Create ~/.pi-harness-runtime/keys/telegram-bot-token.txt for Telegram integration");
  }

  // Demo: transcribe a local audio file
  console.log("\n" + "-".repeat(60));
  console.log("Demo: Transcribing test audio file...");
  
  // Note: In production, this would be triggered by actual Telegram/LINE webhooks
  // For testing, you can manually transcribe an audio file:
  //
  // const result = await transcriber.transcribe({
  //   audioUrl: "https://example.com/audio.ogg",
  //   language: "en",
  // });
  // console.log("Transcribed:", result.text);

  console.log("\n" + "=".repeat(60));
  console.log("Ready for voice commands!");
  console.log("=".repeat(60));
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
