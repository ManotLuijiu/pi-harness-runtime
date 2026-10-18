/**
 * Multi-Channel Notification Center
 * 
 * Unified notification system supporting Telegram and LINE.
 * Users can configure which channels to use and toggle them via inline buttons.
 */

import * as https from "https";

export interface NotificationConfig {
  telegram?: {
    botToken: string;
    chatId: string;
    enabled: boolean;
  };
  line?: {
    channelAccessToken: string;
    userId: string;
    enabled: boolean;
  };
}

export interface NotificationEvent {
  type: string;
  emoji: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationButtons {
  label: string;
  action: string;
  style?: "primary" | "secondary" | "danger";
}

const DEFAULT_CONFIG_FILE = `${process.env.HOME || "/home/frappe"}/.pi-harness-runtime/notification-config.json`;

/**
 * Load notification configuration
 */
function loadConfig(): NotificationConfig {
  try {
    const { existsSync, readFileSync } = require("fs");
    if (existsSync(DEFAULT_CONFIG_FILE)) {
      return JSON.parse(readFileSync(DEFAULT_CONFIG_FILE, "utf-8"));
    }
    } catch (e) {
      console.error("Failed to save notification config:", e);
    }
  return {};
}

/**
 * Save notification configuration
 */
function saveConfig(config: NotificationConfig): void {
  try {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const dir = DEFAULT_CONFIG_FILE.substring(0, DEFAULT_CONFIG_FILE.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(DEFAULT_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save notification config:", e);
  }
}

/**
 * Multi-Channel Notification Center
 */
export class NotificationCenter {
  private config: NotificationConfig;
  
  constructor(config?: Partial<NotificationConfig>) {
    this.config = loadConfig();
    if (config?.telegram) {
      this.config.telegram = { ...this.config.telegram, ...config.telegram };
    }
    if (config?.line) {
      this.config.line = { ...this.config.line, ...config.line };
    }
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.telegram) {
      this.config.telegram = { ...this.config.telegram!, ...updates.telegram };
    }
    if (updates.line) {
      this.config.line = { ...this.config.line!, ...updates.line };
    }
    saveConfig(this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Send notification to all enabled channels
   */
  async notify(event: NotificationEvent): Promise<void> {
    const { telegram, line } = this.config;
    const promises: Promise<void>[] = [];

    if (telegram?.enabled && telegram.botToken && telegram.chatId) {
      promises.push(this.sendTelegram(event, telegram.botToken, telegram.chatId));
    }

    if (line?.enabled && line.channelAccessToken && line.userId) {
      promises.push(this.sendLINE(event, line.channelAccessToken, line.userId));
    }

    await Promise.allSettled(promises);
  }

  /**
   * Send notification with action buttons
   */
  async notifyWithButtons(
    event: NotificationEvent,
    buttons: NotificationButtons[]
  ): Promise<void> {
    const { telegram, line } = this.config;

    if (telegram?.enabled && telegram.botToken && telegram.chatId) {
      await this.sendTelegramWithButtons(event, buttons, telegram.botToken, telegram.chatId);
    }

    if (line?.enabled && line.channelAccessToken && line.userId) {
      await this.sendLINEWithButtons(event, buttons, line.channelAccessToken, line.userId);
    }
  }

  /**
   * Send to Telegram
   */
  private async sendTelegram(
    event: NotificationEvent,
    botToken: string,
    chatId: string
  ): Promise<void> {
    const text = `${event.emoji} ${event.title}\n\n${event.message}`;
    
    await this.telegramRequest(botToken, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    });
  }

  /**
   * Send to Telegram with inline buttons
   */
  private async sendTelegramWithButtons(
    event: NotificationEvent,
    buttons: NotificationButtons[],
    botToken: string,
    chatId: string
  ): Promise<void> {
    const text = `${event.emoji} ${event.title}\n\n${event.message}`;
    const inlineButtons = buttons.map((btn) => ({
      text: btn.label,
      callback_data: btn.action,
    }));

    await this.telegramRequest(botToken, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [inlineButtons],
      },
    });
  }

  /**
   * Telegram API request
   */
  private telegramRequest(botToken: string, method: string, body: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, _reject) => {
      const data = JSON.stringify(body);
      const options = {
        hostname: "api.telegram.org",
        path: `/bot${botToken}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let response = "";
        res.on("data", (chunk) => (response += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(response);
            if (!parsed.ok) {
              console.error(`Telegram API error: ${parsed.description}`);
            }
          } catch (e) {
            console.error(`JSON parse error: ${e}`);
          }
          resolve();
        });
      });

      req.on("error", (err: Error) => {
        console.error(`Telegram API request error: ${err.message}`);
        resolve();
      });
      req.write(data);
      req.end();
    });
  }

  /**
   * Send to LINE
   */
  private async sendLINE(
    event: NotificationEvent,
    accessToken: string,
    userId: string
  ): Promise<void> {
    const text = `${event.emoji} ${event.title}\n\n${event.message}`;

    await this.lineRequest(accessToken, "push", {
      to: userId,
      messages: [{ type: "text", text }],
    });
  }

  /**
   * Send to LINE with quick reply buttons
   */
  private async sendLINEWithButtons(
    event: NotificationEvent,
    buttons: NotificationButtons[],
    accessToken: string,
    userId: string
  ): Promise<void> {
    const text = `${event.emoji} ${event.title}\n\n${event.message}`;
    
    const actions = buttons.map((btn) => ({
      type: "message" as const,
      label: btn.label,
      text: btn.action,
    }));

    await this.lineRequest(accessToken, "push", {
      to: userId,
      messages: [
        { type: "text", text },
        {
          type: "text",
          text: "Quick actions:",
          quickReply: {
            items: actions.map((action) => ({
              type: "action",
              action,
            })),
          },
        },
      ],
    });
  }

  /**
   * LINE API request
   */
  private lineRequest(accessToken: string, method: string, body: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const options = {
        hostname: "api.line.me",
        path: `/v2/bot/message/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Length": Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let response = "";
        res.on("data", (chunk) => (response += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            console.error(`LINE API error: ${res.statusCode} ${response}`);
          }
          resolve();
        });
      });

      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  /**
   * Toggle Telegram notifications
   */
  toggleTelegram(enabled: boolean): void {
    if (!this.config.telegram) {
      this.config.telegram = { botToken: "", chatId: "", enabled };
    } else {
      this.config.telegram.enabled = enabled;
    }
    saveConfig(this.config);
  }

  /**
   * Toggle LINE notifications
   */
  toggleLINE(enabled: boolean): void {
    if (!this.config.line) {
      this.config.line = { channelAccessToken: "", userId: "", enabled };
    } else {
      this.config.line.enabled = enabled;
    }
    saveConfig(this.config);
  }

  /**
   * Check if Telegram is enabled
   */
  isTelegramEnabled(): boolean {
    return this.config.telegram?.enabled ?? false;
  }

  /**
   * Check if LINE is enabled
   */
  isLINEEnabled(): boolean {
    return this.config.line?.enabled ?? false;
  }
}

// Export singleton
let center: NotificationCenter | null = null;

export function getNotificationCenter(): NotificationCenter {
  if (!center) {
    center = new NotificationCenter();
  }
  return center;
}

export function initNotificationCenter(config?: Partial<NotificationConfig>): NotificationCenter {
  center = new NotificationCenter(config);
  return center;
}
