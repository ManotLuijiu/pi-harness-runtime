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
    id: string;
    type: "approval.granted" | "approval.rejected" | "approval.requested" | "checkpoint.created" | "checkpoint.restored" | "error.occurred" | "job.cancelled" | "job.completed" | "job.created" | "job.failed" | "job.progress" | "job.started" | "policy.acknowledged" | "policy.updated" | "session.ended" | "session.started" | "tool.executed" | "tool.failed";
    timestamp: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    id: string;
    type: "approval.granted" | "approval.rejected" | "approval.requested" | "checkpoint.created" | "checkpoint.restored" | "error.occurred" | "job.cancelled" | "job.completed" | "job.created" | "job.failed" | "job.progress" | "job.started" | "policy.acknowledged" | "policy.updated" | "session.ended" | "session.started" | "tool.executed" | "tool.failed";
    timestamp: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    metadata?: Record<string, unknown> | undefined;
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
    type: "approval.granted" | "approval.rejected" | "approval.requested" | "checkpoint.created" | "checkpoint.restored" | "error.occurred" | "job.cancelled" | "job.completed" | "job.created" | "job.failed" | "job.progress" | "job.started" | "policy.acknowledged" | "policy.updated" | "session.ended" | "session.started" | "tool.executed" | "tool.failed";
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    type: "approval.granted" | "approval.rejected" | "approval.requested" | "checkpoint.created" | "checkpoint.restored" | "error.occurred" | "job.cancelled" | "job.completed" | "job.created" | "job.failed" | "job.progress" | "job.started" | "policy.acknowledged" | "policy.updated" | "session.ended" | "session.started" | "tool.executed" | "tool.failed";
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    payload?: Record<string, unknown> | undefined;
    metadata?: Record<string, unknown> | undefined;
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
    types?: ("approval.granted" | "approval.rejected" | "approval.requested" | "checkpoint.created" | "checkpoint.restored" | "error.occurred" | "job.cancelled" | "job.completed" | "job.created" | "job.failed" | "job.progress" | "job.started" | "policy.acknowledged" | "policy.updated" | "session.ended" | "session.started" | "tool.executed" | "tool.failed")[] | undefined;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit: number;
    cursor?: string | undefined;
}, {
    types?: ("approval.granted" | "approval.rejected" | "approval.requested" | "checkpoint.created" | "checkpoint.restored" | "error.occurred" | "job.cancelled" | "job.completed" | "job.created" | "job.failed" | "job.progress" | "job.started" | "policy.acknowledged" | "policy.updated" | "session.ended" | "session.started" | "tool.executed" | "tool.failed")[] | undefined;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
}>;
export type EventFilter = z.infer<typeof EventFilter>;
