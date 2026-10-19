// base-adapter.js
class BaseChannelAdapter {
  config;
  constructor(config) {
    this.config = config;
  }
  isConfigured() {
    return this.config.enabled;
  }
  redact(payload, patterns) {
    if (patterns.length === 0)
      return payload;
    const redacted = [];
    const details = payload.details ? { ...payload.details } : {};
    for (const [key, value] of Object.entries(details)) {
      const valStr = String(value);
      for (const pattern of patterns) {
        if (pattern.test(valStr)) {
          redacted.push(key);
          details[key] = "[REDACTED]";
          break;
        }
      }
    }
    return {
      ...payload,
      details,
      redacted: redacted.length > 0 ? redacted : undefined
    };
  }
}

// adapters/telegram-adapter.ts
class TelegramAdapter extends BaseChannelAdapter {
  id = "telegram";
  type = "telegram";
  constructor(config) {
    super({ id: "telegram", type: "telegram", enabled: true, config });
  }
  async initialize() {
    try {
      const cfg = this.config.config;
      const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
      return response.ok;
    } catch {
      return false;
    }
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const message = this.formatMessage(payload);
      const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: message,
          parse_mode: cfg.parseMode ?? "MarkdownV2"
        })
      });
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.id,
          error: `Telegram API error: ${error}`
        };
      }
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
  formatMessage(payload) {
    const emoji = this.getEmoji(payload.event);
    const title = `${emoji} ${payload.title}`;
    const lines = [title, "", payload.message];
    if (payload.details?.taskTitle) {
      lines.push("", `Task: ${payload.details.taskTitle}`);
    }
    if (payload.details?.jobId) {
      lines.push(`Job: ${payload.details.jobId}`);
    }
    if (payload.details?.error) {
      lines.push("", `Error: ${payload.details.error}`);
    }
    return lines.filter(Boolean).join(`
`);
  }
  getEmoji(event) {
    const map = {
      JobStarted: "\uD83D\uDE80",
      TaskCompleted: "✅",
      TaskFailed: "❌",
      QuotaPaused: "⏸️",
      ResumeScheduled: "▶️",
      ContextCompacted: "\uD83D\uDCE6",
      OutputLimitContinued: "\uD83D\uDD04",
      E2EFailed: "\uD83E\uDDEA",
      HumanReviewNeeded: "\uD83D\uDC64",
      ReadyForClient: "\uD83C\uDF89",
      JobCancelled: "\uD83D\uDEAB",
      Error: "⚠️"
    };
    return map[event] ?? "\uD83D\uDCE2";
  }
}

// adapters/ntfy-adapter.ts
class NtfyAdapter extends BaseChannelAdapter {
  id = "ntfy";
  type = "ntfy";
  constructor(config) {
    super({ id: "ntfy", type: "ntfy", enabled: true, config });
  }
  async initialize() {
    return true;
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const message = this.formatMessage(payload);
      const headers = {
        "Content-Type": "text/plain",
        Title: payload.title,
        Tags: this.getTags(payload.event)
      };
      if (cfg.authToken) {
        headers["Authorization"] = `Bearer ${cfg.authToken}`;
      }
      const response = await fetch(`${cfg.server}/${cfg.topic}`, {
        method: "POST",
        headers,
        body: message
      });
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.id,
          error: `Ntfy error: ${error}`
        };
      }
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
  formatMessage(payload) {
    const lines = [payload.message];
    if (payload.details?.taskTitle) {
      lines.push(`
Task: ${payload.details.taskTitle}`);
    }
    if (payload.details?.jobId) {
      lines.push(`Job: ${payload.details.jobId}`);
    }
    if (payload.details?.error) {
      lines.push(`
Error: ${payload.details.error}`);
    }
    return lines.join("");
  }
  getTags(event) {
    const map = {
      JobStarted: "rocket",
      TaskCompleted: "white_check_mark",
      TaskFailed: "x",
      QuotaPaused: "pause_button",
      ResumeScheduled: "play_button",
      ContextCompacted: "package",
      OutputLimitContinued: "repeat",
      E2EFailed: "test_tube",
      HumanReviewNeeded: "bust_in_silhouette",
      ReadyForClient: "tada",
      JobCancelled: "no_entry",
      Error: "warning"
    };
    return map[event] ?? "bell";
  }
}

// adapters/email-adapter.ts
async function sendSmtpEmail(host, port, user, password, from, to, subject, body, tls = false) {
  console.log(`[Email] Would send to ${to.join(", ")}`);
  console.log(`[Email] Subject: ${subject}`);
  console.log(`[Email] Body: ${body}`);
}

class EmailAdapter extends BaseChannelAdapter {
  id = "email";
  type = "email";
  constructor(config) {
    super({ id: "email", type: "email", enabled: true, config });
  }
  async initialize() {
    try {
      const cfg = this.config.config;
      return Boolean(cfg.smtpHost && cfg.smtpUser && cfg.from && cfg.to.length > 0);
    } catch {
      return false;
    }
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const subject = `${this.getEmoji(payload.event)} ${payload.title}`;
      const body = this.formatBody(payload);
      await sendSmtpEmail(cfg.smtpHost, cfg.smtpPort, cfg.smtpUser, cfg.smtpPassword, cfg.from, cfg.to, subject, body, cfg.tls);
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
  formatBody(payload) {
    const lines = [
      payload.message,
      "",
      "---",
      `Event: ${payload.event}`,
      `Time: ${payload.timestamp}`
    ];
    if (payload.details?.taskTitle) {
      lines.push(`Task: ${payload.details.taskTitle}`);
    }
    if (payload.details?.jobId) {
      lines.push(`Job ID: ${payload.details.jobId}`);
    }
    if (payload.details?.error) {
      lines.push("", `Error: ${payload.details.error}`);
    }
    return lines.join(`
`);
  }
  getEmoji(event) {
    const map = {
      JobStarted: "[\uD83D\uDE80]",
      TaskCompleted: "[✅]",
      TaskFailed: "[❌]",
      QuotaPaused: "[⏸]",
      ResumeScheduled: "[▶]",
      ContextCompacted: "[\uD83D\uDCE6]",
      OutputLimitContinued: "[\uD83D\uDD04]",
      E2EFailed: "[\uD83E\uDDEA]",
      HumanReviewNeeded: "[\uD83D\uDC64]",
      ReadyForClient: "[\uD83C\uDF89]",
      JobCancelled: "[\uD83D\uDEAB]",
      Error: "[⚠]"
    };
    return map[event] ?? "[\uD83D\uDCE2]";
  }
}

// adapters/webhook-adapter.ts
class WebhookAdapter extends BaseChannelAdapter {
  id = "webhook";
  type = "webhook";
  constructor(config) {
    super({ id: "webhook", type: "webhook", enabled: true, config });
  }
  async initialize() {
    try {
      const cfg = this.config.config;
      return Boolean(cfg.url && cfg.url.startsWith("http"));
    } catch {
      return false;
    }
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const headers = {
        "Content-Type": "application/json",
        ...cfg.headers ?? {}
      };
      if (cfg.authToken) {
        headers["Authorization"] = `Bearer ${cfg.authToken}`;
      }
      const response = await fetch(cfg.url, {
        method: cfg.method ?? "POST",
        headers,
        body: JSON.stringify({
          event: payload.event,
          jobId: payload.jobId,
          timestamp: payload.timestamp,
          title: payload.title,
          message: payload.message,
          details: payload.details
        })
      });
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.id,
          error: `Webhook error ${response.status}: ${error}`
        };
      }
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
}

// notification-center.js
class NotificationCenter {
  adapters = new Map;
  redactPatterns;
  constructor(config) {
    this.redactPatterns = config?.redactPatterns ?? this.getDefaultRedactPatterns();
    if (config?.channels) {
      for (const channelConfig of config.channels) {
        if (channelConfig.enabled) {
          this.registerAdapter(channelConfig);
        }
      }
    }
  }
  registerAdapter(config) {
    try {
      const adapter = this.createAdapter(config);
      if (adapter && adapter.isConfigured()) {
        this.adapters.set(config.id, adapter);
        return true;
      }
    } catch (error) {
      console.error(`[NotificationCenter] Failed to register adapter: ${error}`);
    }
    return false;
  }
  async initialize() {
    const adapterEntries = Array.from(this.adapters.entries());
    for (const [id, adapter] of adapterEntries) {
      try {
        const ok = await adapter.initialize();
        if (!ok) {
          console.warn(`[NotificationCenter] Adapter ${id} initialization failed`);
        }
      } catch (error) {
        console.warn(`[NotificationCenter] Adapter ${id} initialization error: ${error}`);
      }
    }
  }
  async notify(event, context) {
    const payload = this.buildPayload(event, context);
    const results = [];
    const adapterEntries = Array.from(this.adapters.entries());
    const promises = adapterEntries.map(async ([id, adapter]) => {
      try {
        const redactedPayload = this.redact(payload);
        const result = await adapter.send(redactedPayload);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          channel: id,
          error: String(error)
        });
      }
    });
    await Promise.all(promises);
    return results;
  }
  async notifyChannel(channelId, event, context) {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      return { success: false, channel: channelId, error: "Adapter not found" };
    }
    try {
      const payload = this.redact(this.buildPayload(event, context));
      return await adapter.send(payload);
    } catch (error) {
      return { success: false, channel: channelId, error: String(error) };
    }
  }
  hasChannels() {
    return this.adapters.size > 0;
  }
  listChannels() {
    return Array.from(this.adapters.keys());
  }
  createAdapter(config) {
    switch (config.type) {
      case "telegram":
        return new TelegramAdapter(config.config);
      case "ntfy":
        return new NtfyAdapter(config.config);
      case "email":
        return new EmailAdapter(config.config);
      case "webhook":
        return new WebhookAdapter(config.config);
      default:
        return null;
    }
  }
  buildPayload(event, context) {
    const { title, message } = this.getEventContent(event, context);
    return {
      event,
      jobId: context.jobId,
      timestamp: new Date().toISOString(),
      title,
      message,
      details: {
        jobId: context.jobId,
        requirement: context.requirement,
        ...context.taskId && { taskId: context.taskId },
        ...context.taskTitle && { taskTitle: context.taskTitle },
        ...context.error && { error: context.error }
      }
    };
  }
  getEventContent(event, context) {
    const requirement = context.requirement.length > 50 ? context.requirement.slice(0, 50) + "..." : context.requirement;
    const map = {
      JobStarted: {
        title: "Job Started",
        message: `Harness job started for: "${requirement}"`
      },
      TaskCompleted: {
        title: "Task Completed",
        message: `Task "${context.taskTitle ?? "Unknown"}" completed successfully`
      },
      TaskFailed: {
        title: "Task Failed",
        message: `Task "${context.taskTitle ?? "Unknown"}" failed${context.error ? `: ${context.error}` : ""}`
      },
      QuotaPaused: {
        title: "Quota Paused",
        message: `Job paused due to quota limit. Will auto-resume when quota resets.`
      },
      ResumeScheduled: {
        title: "Resume Scheduled",
        message: `Job will resume work on: "${requirement}"`
      },
      ContextCompacted: {
        title: "Context Compacted",
        message: `Session context was compacted to continue work on: "${requirement}"`
      },
      OutputLimitContinued: {
        title: "Output Limit Continued",
        message: `Response was continued after hitting output token limit`
      },
      E2EFailed: {
        title: "E2E Test Failed",
        message: `End-to-end tests failed for job: "${requirement}"`
      },
      HumanReviewNeeded: {
        title: "Human Review Needed",
        message: `Job blocked. Please review and take action.`
      },
      ReadyForClient: {
        title: "Ready for Review",
        message: `Job completed successfully and ready for your review: "${requirement}"`
      },
      JobCancelled: {
        title: "Job Cancelled",
        message: `Job was cancelled: "${requirement}"`
      },
      Error: {
        title: "Runtime Error",
        message: `An error occurred${context.error ? `: ${context.error}` : ""}`
      }
    };
    return map[event] ?? { title: event, message: `Event: ${event}` };
  }
  redact(payload) {
    const details = payload.details ? { ...payload.details } : {};
    for (const pattern of this.redactPatterns) {
      for (const [key, value] of Object.entries(details)) {
        if (typeof value === "string" && pattern.test(value)) {
          details[key] = "[REDACTED]";
        }
      }
    }
    return { ...payload, details };
  }
  getDefaultRedactPatterns() {
    return [
      /Bearer\s+[\w-]+/gi,
      /password["\s:=]+[^\s,}]+/gi,
      /cookie["\s:=]+[^\s,}]+/gi,
      /secret["\s:=]+[^\s,}]+/gi,
      /api[_-]?key["\s:=]+[^\s,}]+/gi,
      /auth["\s:=]+[^\s,}]+/gi
    ];
  }
}
// base-adapter.ts
class BaseChannelAdapter2 {
  config;
  constructor(config) {
    this.config = config;
  }
  isConfigured() {
    return this.config.enabled;
  }
  redact(payload, patterns) {
    if (patterns.length === 0)
      return payload;
    const redacted = [];
    const details = payload.details ? { ...payload.details } : {};
    for (const [key, value] of Object.entries(details)) {
      const valStr = String(value);
      for (const pattern of patterns) {
        if (pattern.test(valStr)) {
          redacted.push(key);
          details[key] = "[REDACTED]";
          break;
        }
      }
    }
    return {
      ...payload,
      details,
      redacted: redacted.length > 0 ? redacted : undefined
    };
  }
}

// adapters/telegram-adapter.js
class TelegramAdapter2 extends BaseChannelAdapter2 {
  id = "telegram";
  type = "telegram";
  constructor(config) {
    super({ id: "telegram", type: "telegram", enabled: true, config });
  }
  async initialize() {
    try {
      const cfg = this.config.config;
      const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
      return response.ok;
    } catch {
      return false;
    }
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const message = this.formatMessage(payload);
      const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: message,
          parse_mode: cfg.parseMode ?? "MarkdownV2"
        })
      });
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.id,
          error: `Telegram API error: ${error}`
        };
      }
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
  formatMessage(payload) {
    const emoji = this.getEmoji(payload.event);
    const title = `${emoji} ${payload.title}`;
    const lines = [title, "", payload.message];
    if (payload.details?.taskTitle) {
      lines.push("", `Task: ${payload.details.taskTitle}`);
    }
    if (payload.details?.jobId) {
      lines.push(`Job: ${payload.details.jobId}`);
    }
    if (payload.details?.error) {
      lines.push("", `Error: ${payload.details.error}`);
    }
    return lines.filter(Boolean).join(`
`);
  }
  getEmoji(event) {
    const map = {
      JobStarted: "\uD83D\uDE80",
      TaskCompleted: "✅",
      TaskFailed: "❌",
      QuotaPaused: "⏸️",
      ResumeScheduled: "▶️",
      ContextCompacted: "\uD83D\uDCE6",
      OutputLimitContinued: "\uD83D\uDD04",
      E2EFailed: "\uD83E\uDDEA",
      HumanReviewNeeded: "\uD83D\uDC64",
      ReadyForClient: "\uD83C\uDF89",
      JobCancelled: "\uD83D\uDEAB",
      Error: "⚠️"
    };
    return map[event] ?? "\uD83D\uDCE2";
  }
}
// adapters/ntfy-adapter.js
class NtfyAdapter2 extends BaseChannelAdapter2 {
  id = "ntfy";
  type = "ntfy";
  constructor(config) {
    super({ id: "ntfy", type: "ntfy", enabled: true, config });
  }
  async initialize() {
    return true;
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const message = this.formatMessage(payload);
      const headers = {
        "Content-Type": "text/plain",
        Title: payload.title,
        Tags: this.getTags(payload.event)
      };
      if (cfg.authToken) {
        headers["Authorization"] = `Bearer ${cfg.authToken}`;
      }
      const response = await fetch(`${cfg.server}/${cfg.topic}`, {
        method: "POST",
        headers,
        body: message
      });
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.id,
          error: `Ntfy error: ${error}`
        };
      }
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
  formatMessage(payload) {
    const lines = [payload.message];
    if (payload.details?.taskTitle) {
      lines.push(`
Task: ${payload.details.taskTitle}`);
    }
    if (payload.details?.jobId) {
      lines.push(`Job: ${payload.details.jobId}`);
    }
    if (payload.details?.error) {
      lines.push(`
Error: ${payload.details.error}`);
    }
    return lines.join("");
  }
  getTags(event) {
    const map = {
      JobStarted: "rocket",
      TaskCompleted: "white_check_mark",
      TaskFailed: "x",
      QuotaPaused: "pause_button",
      ResumeScheduled: "play_button",
      ContextCompacted: "package",
      OutputLimitContinued: "repeat",
      E2EFailed: "test_tube",
      HumanReviewNeeded: "bust_in_silhouette",
      ReadyForClient: "tada",
      JobCancelled: "no_entry",
      Error: "warning"
    };
    return map[event] ?? "bell";
  }
}
// adapters/email-adapter.js
async function sendSmtpEmail2(host, port, user, password, from, to, subject, body, tls = false) {
  console.log(`[Email] Would send to ${to.join(", ")}`);
  console.log(`[Email] Subject: ${subject}`);
  console.log(`[Email] Body: ${body}`);
}

class EmailAdapter2 extends BaseChannelAdapter2 {
  id = "email";
  type = "email";
  constructor(config) {
    super({ id: "email", type: "email", enabled: true, config });
  }
  async initialize() {
    try {
      const cfg = this.config.config;
      return Boolean(cfg.smtpHost && cfg.smtpUser && cfg.from && cfg.to.length > 0);
    } catch {
      return false;
    }
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const subject = `${this.getEmoji(payload.event)} ${payload.title}`;
      const body = this.formatBody(payload);
      await sendSmtpEmail2(cfg.smtpHost, cfg.smtpPort, cfg.smtpUser, cfg.smtpPassword, cfg.from, cfg.to, subject, body, cfg.tls);
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
  formatBody(payload) {
    const lines = [
      payload.message,
      "",
      "---",
      `Event: ${payload.event}`,
      `Time: ${payload.timestamp}`
    ];
    if (payload.details?.taskTitle) {
      lines.push(`Task: ${payload.details.taskTitle}`);
    }
    if (payload.details?.jobId) {
      lines.push(`Job ID: ${payload.details.jobId}`);
    }
    if (payload.details?.error) {
      lines.push("", `Error: ${payload.details.error}`);
    }
    return lines.join(`
`);
  }
  getEmoji(event) {
    const map = {
      JobStarted: "[\uD83D\uDE80]",
      TaskCompleted: "[✅]",
      TaskFailed: "[❌]",
      QuotaPaused: "[⏸]",
      ResumeScheduled: "[▶]",
      ContextCompacted: "[\uD83D\uDCE6]",
      OutputLimitContinued: "[\uD83D\uDD04]",
      E2EFailed: "[\uD83E\uDDEA]",
      HumanReviewNeeded: "[\uD83D\uDC64]",
      ReadyForClient: "[\uD83C\uDF89]",
      JobCancelled: "[\uD83D\uDEAB]",
      Error: "[⚠]"
    };
    return map[event] ?? "[\uD83D\uDCE2]";
  }
}
// adapters/webhook-adapter.js
class WebhookAdapter2 extends BaseChannelAdapter2 {
  id = "webhook";
  type = "webhook";
  constructor(config) {
    super({ id: "webhook", type: "webhook", enabled: true, config });
  }
  async initialize() {
    try {
      const cfg = this.config.config;
      return Boolean(cfg.url && cfg.url.startsWith("http"));
    } catch {
      return false;
    }
  }
  async send(payload) {
    try {
      const cfg = this.config.config;
      const headers = {
        "Content-Type": "application/json",
        ...cfg.headers ?? {}
      };
      if (cfg.authToken) {
        headers["Authorization"] = `Bearer ${cfg.authToken}`;
      }
      const response = await fetch(cfg.url, {
        method: cfg.method ?? "POST",
        headers,
        body: JSON.stringify({
          event: payload.event,
          jobId: payload.jobId,
          timestamp: payload.timestamp,
          title: payload.title,
          message: payload.message,
          details: payload.details
        })
      });
      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.id,
          error: `Webhook error ${response.status}: ${error}`
        };
      }
      return { success: true, channel: this.id };
    } catch (error) {
      return {
        success: false,
        channel: this.id,
        error: String(error)
      };
    }
  }
}
export {
  WebhookAdapter2 as WebhookAdapter,
  TelegramAdapter2 as TelegramAdapter,
  NtfyAdapter2 as NtfyAdapter,
  NotificationCenter,
  EmailAdapter2 as EmailAdapter
};
