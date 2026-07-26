/**
 * Event Store — Types
 */
export type SessionEventType = "message" | "tool_start" | "tool_end" | "tool_error" | "assistant_start" | "assistant_end" | "session_start" | "session_end" | "checkpoint" | "compact";
export interface EventMetadata {
    model?: string;
    provider?: string;
    tokens?: number;
    durationMs?: number;
}
export interface SessionEvent {
    id: string;
    sessionId: string;
    timestamp: string;
    type: SessionEventType;
    role?: "user" | "assistant" | "system";
    content?: string;
    tool?: string;
    error?: string;
    metadata?: EventMetadata;
}
export interface StoreOptions {
    sessionsDir?: string;
}
export interface StoreStats {
    sessionId: string;
    totalEvents: number;
    sizeBytes: number;
    lastEventAt: string | null;
}
export interface WriteResult {
    id: string;
    timestamp: string;
    bytesWritten: number;
}
export interface ReadOptions {
    sessionId?: string;
    since?: string;
    types?: SessionEventType[];
    limit?: number;
    offset?: number;
}
export interface SearchOptions {
    sessionId?: string;
    query: string;
    limit?: number;
}
//# sourceMappingURL=types.d.ts.map