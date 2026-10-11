/**
 * Harness Types
 *
 * Structured types for harness runtime status.
 */
/**
 * Overall harness status
 */
export interface HarnessStatus {
    /** Version string */
    version: string;
    /** Tagline description */
    tagline: string;
    /** Runtime initialization status */
    runtime: StatusDetail;
    /** Qdrant vector database status */
    qdrant?: StatusDetail;
    /** Honcho integration status */
    honcho?: HonchoStatus;
    /** Telegram integration status */
    telegram?: TelegramStatus;
    /** Skills discovery status */
    skills?: SkillsStatus;
    /** Registered commands */
    commands?: string[];
}
/**
 * Basic status detail
 */
export interface StatusDetail {
    /** Current status text */
    status: string;
    /** Optional details */
    details?: string;
    /** Error message if failed */
    error?: string;
}
/**
 * Honcho-specific status
 */
export interface HonchoStatus extends StatusDetail {
    /** Session ID if connected */
    sessionId?: string;
    /** Whether memory is configured */
    memoryConfigured?: boolean;
}
/**
 * Telegram-specific status
 */
export interface TelegramStatus extends StatusDetail {
    /** Bot username */
    botName?: string;
    /** Whether outbound is verified */
    outboundVerified?: boolean;
    /** Whether inbound is connected */
    inboundConnected?: boolean;
}
/**
 * Skills status
 */
export interface SkillsStatus {
    /** Number of skills discovered */
    count: number;
    /** Number of commands registered */
    commandCount?: number;
}
/**
 * Widget state for UI
 */
export interface WidgetState {
    /** Whether widget is expanded */
    expanded: boolean;
    /** Current harness status */
    status: HarnessStatus;
    /** Last updated timestamp */
    updatedAt: number;
}
/**
 * Widget update event
 */
export interface WidgetUpdateEvent {
    /** What changed */
    change: "status" | "expansion" | "commands";
    /** Updated status if applicable */
    status?: Partial<HarnessStatus>;
}
//# sourceMappingURL=harness-types.d.ts.map