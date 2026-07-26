/**
 * Event Bus — Types
 */
export type Topic = "session.message" | "session.assistant_start" | "session.assistant_end" | "session.tool_start" | "session.tool_end" | "session.checkpoint" | "session.compact" | "task.assigned" | "task.started" | "task.completed" | "task.failed" | "review.requested" | "review.completed" | "decision.made" | "approval.requested" | "approval.granted" | "workflow.started" | "workflow.finished" | "knowledge.extracted" | "system.quota_exceeded" | "system.checkpoint_saved" | "system.error";
export interface EventPayload<T = unknown> {
    topic: string;
    data: T;
    timestamp: string;
    eventId: string;
    source: string;
}
export type Subscriber<T = unknown> = (payload: EventPayload<T>) => void | Promise<void>;
export interface Subscription {
    id: string;
    topic: string;
    subscriber: Subscriber<unknown>;
    filter?: (data: unknown) => boolean;
    priority: number;
    active: boolean;
}
export interface BusOptions {
    deliveryGuarantee?: "at_least_once" | "at_most_once" | "exactly_once";
}
export declare class EventBusError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=types.d.ts.map