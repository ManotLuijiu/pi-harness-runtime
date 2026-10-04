/**
 * Notification Policy Engine for intelligent routing
 * 
 * Decides:
 * 1. Should we notify at all?
 * 2. What channel(s)?
 * 3. Should we include approval buttons?
 * 4. What's the priority level?
 * 
 * Can be extended with Jev for AI-powered decisions:
 * import { Jev } from "@type-safe/ai";
 */

export interface NotificationContext {
  event: string;
  jobId?: string;
  requirement?: string;
  error?: string;
  severity?: "low" | "medium" | "high" | "critical";
  requiresApproval?: boolean;
  userId?: number;
  timestamp?: string;
}

export interface NotificationPolicy {
  shouldNotify: boolean;
  channels: ("telegram" | "tui" | "log")[];
  includeButtons: boolean;
  priority: "low" | "normal" | "high" | "urgent";
  message?: string;
}

export interface UserPreferences {
  telegramEnabled: boolean;
  telegramChatId?: string;
  telegramBotToken?: string;
  tuiEnabled: boolean;
  notifyOnError: boolean;
  notifyOnCompletion: boolean;
  notifyOnApprovalRequired: boolean;
}

// Default preferences
const DEFAULT_PREFERENCES: UserPreferences = {
  telegramEnabled: false,
  tuiEnabled: true,
  notifyOnError: true,
  notifyOnCompletion: false,
  notifyOnApprovalRequired: true,
};

/**
 * Events that require user approval
 */
const APPROVAL_REQUIRED_EVENTS = new Set([
  "HumanReviewNeeded",
  "WaitingForUserInput",
  "ApprovalRequired",
  "ConfirmDeploy",
  "ConfirmDelete",
  "ConfirmCriticalAction",
]);

/**
 * High-priority events (always notify)
 */
const HIGH_PRIORITY_EVENTS = new Set([
  "QuotaExhausted",
  "CriticalError",
  "HumanReviewNeeded",
  "WaitingForUserInput",
  "JobFailed",
  "SystemAlert",
]);

/**
 * Notification policy engine
 */
export class NotificationPolicyEngine {
  private preferences: UserPreferences;

  constructor(preferences?: Partial<UserPreferences>) {
    this.preferences = { ...DEFAULT_PREFERENCES, ...preferences };
  }

  /**
   * Update user preferences
   */
  updatePreferences(prefs: Partial<UserPreferences>): void {
    this.preferences = { ...this.preferences, ...prefs };
  }

  /**
   * Evaluate notification policy
   */
  evaluate(context: NotificationContext): NotificationPolicy {
    const event = context.event;
    const severity = context.severity || this.inferSeverity(event);
    const needsApproval = APPROVAL_REQUIRED_EVENTS.has(event);

    // Build channels
    const channels: ("telegram" | "tui" | "log")[] = [];
    
    if (this.preferences.telegramEnabled && this.preferences.telegramChatId) {
      channels.push("telegram");
    }
    
    if (this.preferences.tuiEnabled) {
      channels.push("tui");
    }

    // Decide based on event type and severity
    let shouldNotify = false;
    let includeButtons = false;
    let priority: NotificationPolicy["priority"] = "normal";

    switch (event) {
      case "HumanReviewNeeded":
      case "WaitingForUserInput":
      case "ApprovalRequired":
        shouldNotify = this.preferences.notifyOnApprovalRequired;
        includeButtons = true;
        priority = "high";
        break;

      case "CriticalError":
      case "SystemAlert":
        shouldNotify = true;
        includeButtons = needsApproval;
        priority = "urgent";
        break;

      case "QuotaExhausted":
        shouldNotify = true;
        includeButtons = false;
        priority = "high";
        break;

      case "JobCompleted":
        shouldNotify = this.preferences.notifyOnCompletion;
        includeButtons = false;
        priority = "low";
        break;

      case "Error":
      case "JobFailed":
        shouldNotify = this.preferences.notifyOnError;
        includeButtons = needsApproval;
        priority = severity === "high" || severity === "critical" ? "high" : "normal";
        break;

      default:
        shouldNotify = severity === "high" || severity === "critical";
        includeButtons = needsApproval;
        priority = severity === "critical" ? "urgent" : severity === "high" ? "high" : "low";
    }

    // Always notify for high-priority events
    if (HIGH_PRIORITY_EVENTS.has(event)) {
      shouldNotify = true;
      if (priority !== "urgent") {
        priority = "high";
      }
    }

    return {
      shouldNotify,
      channels: channels.length > 0 ? channels : ["log"],
      includeButtons,
      priority,
    };
  }

  /**
   * Infer severity from event name
   */
  private inferSeverity(event: string): "low" | "medium" | "high" | "critical" {
    if (event.includes("Critical") || event.includes("Emergency")) {
      return "critical";
    }
    if (event.includes("Error") || event.includes("Failed") || event.includes("Exhausted")) {
      return "high";
    }
    if (event.includes("Warning") || event.includes("Alert")) {
      return "medium";
    }
    return "low";
  }
}

/**
 * Check if an event requires approval buttons
 */
export function requiresApproval(event: string): boolean {
  return APPROVAL_REQUIRED_EVENTS.has(event);
}

/**
 * Check if an event is high priority
 */
export function isHighPriority(event: string): boolean {
  return HIGH_PRIORITY_EVENTS.has(event);
}
