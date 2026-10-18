/**
 * Event schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Event types
 */
export declare const EventType: z.ZodEnum<["job.created", "job.started", "job.progress", "job.completed", "job.failed", "job.cancelled", "session.started", "session.ended", "approval.requested", "approval.granted", "approval.rejected", "policy.acknowledged", "policy.updated", "tool.executed", "tool.failed", "checkpoint.created", "checkpoint.restored", "error.occurred"]>;
export type EventType = z.infer<typeof EventType>;
/**
 * Base event schema
 */
export declare const Event: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["job.created", "job.started", "job.progress", "job.completed", "job.failed", "job.cancelled", "session.started", "session.ended", "approval.requested", "approval.granted", "approval.rejected", "policy.acknowledged", "policy.updated", "tool.executed", "tool.failed", "checkpoint.created", "checkpoint.restored", "error.occurred"]>;
    timestamp: z.ZodString;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled" | "session.started" | "session.ended" | "approval.requested" | "approval.granted" | "approval.rejected" | "policy.acknowledged" | "policy.updated" | "tool.executed" | "tool.failed" | "checkpoint.created" | "checkpoint.restored" | "error.occurred";
    id: string;
    timestamp: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    type: "job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled" | "session.started" | "session.ended" | "approval.requested" | "approval.granted" | "approval.rejected" | "policy.acknowledged" | "policy.updated" | "tool.executed" | "tool.failed" | "checkpoint.created" | "checkpoint.restored" | "error.occurred";
    id: string;
    timestamp: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
export type Event = z.infer<typeof Event>;
/**
 * Event creation input
 */
export declare const EventCreate: z.ZodObject<{
    type: z.ZodEnum<["job.created", "job.started", "job.progress", "job.completed", "job.failed", "job.cancelled", "session.started", "session.ended", "approval.requested", "approval.granted", "approval.rejected", "policy.acknowledged", "policy.updated", "tool.executed", "tool.failed", "checkpoint.created", "checkpoint.restored", "error.occurred"]>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled" | "session.started" | "session.ended" | "approval.requested" | "approval.granted" | "approval.rejected" | "policy.acknowledged" | "policy.updated" | "tool.executed" | "tool.failed" | "checkpoint.created" | "checkpoint.restored" | "error.occurred";
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    type: "job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled" | "session.started" | "session.ended" | "approval.requested" | "approval.granted" | "approval.rejected" | "policy.acknowledged" | "policy.updated" | "tool.executed" | "tool.failed" | "checkpoint.created" | "checkpoint.restored" | "error.occurred";
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
export type EventCreate = z.infer<typeof EventCreate>;
/**
 * Event filter for queries
 */
export declare const EventFilter: z.ZodObject<{
    types: z.ZodOptional<z.ZodArray<z.ZodEnum<["job.created", "job.started", "job.progress", "job.completed", "job.failed", "job.cancelled", "session.started", "session.ended", "approval.requested", "approval.granted", "approval.rejected", "policy.acknowledged", "policy.updated", "tool.executed", "tool.failed", "checkpoint.created", "checkpoint.restored", "error.occurred"]>, "many">>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    cursor?: string | undefined;
    types?: ("job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled" | "session.started" | "session.ended" | "approval.requested" | "approval.granted" | "approval.rejected" | "policy.acknowledged" | "policy.updated" | "tool.executed" | "tool.failed" | "checkpoint.created" | "checkpoint.restored" | "error.occurred")[] | undefined;
}, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
    types?: ("job.created" | "job.started" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled" | "session.started" | "session.ended" | "approval.requested" | "approval.granted" | "approval.rejected" | "policy.acknowledged" | "policy.updated" | "tool.executed" | "tool.failed" | "checkpoint.created" | "checkpoint.restored" | "error.occurred")[] | undefined;
}>;
export type EventFilter = z.infer<typeof EventFilter>;
