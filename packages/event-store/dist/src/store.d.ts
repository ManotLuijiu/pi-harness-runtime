/**
 * Event Store — JSONL-backed immutable event store
 */
import type { SessionEvent, WriteResult, ReadOptions, SearchOptions, StoreOptions, StoreStats } from "./types.js";
export declare class EventStore {
    private readonly sessionsDir;
    constructor(opts?: StoreOptions);
    getPath(sessionId: string): string;
    append(event: Omit<SessionEvent, "id" | "timestamp">): Promise<WriteResult>;
    read(opts?: ReadOptions): Promise<SessionEvent[]>;
    search(opts: SearchOptions): Promise<SessionEvent[]>;
    stats(sessionId: string): StoreStats;
    list(): string[];
}
//# sourceMappingURL=store.d.ts.map