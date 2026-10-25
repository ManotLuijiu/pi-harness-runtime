/**
 * Event schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Event types
 */
export declare const EventType: z.ZodEnum<{
    "approval.granted": "approval.granted";
    "approval.rejected": "approval.rejected";
    "approval.requested": "approval.requested";
    "checkpoint.created": "checkpoint.created";
    "checkpoint.restored": "checkpoint.restored";
    "error.occurred": "error.occurred";
    "job.cancelled": "job.cancelled";
    "job.completed": "job.completed";
    "job.created": "job.created";
    "job.failed": "job.failed";
    "job.progress": "job.progress";
    "job.started": "job.started";
    "policy.acknowledged": "policy.acknowledged";
    "policy.updated": "policy.updated";
    "session.ended": "session.ended";
    "session.started": "session.started";
    "tool.executed": "tool.executed";
    "tool.failed": "tool.failed";
}>;
export type EventType = z.infer<typeof EventType>;
/**
 * Base event schema
 */
export declare const Event: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<{
        "approval.granted": "approval.granted";
        "approval.rejected": "approval.rejected";
        "approval.requested": "approval.requested";
        "checkpoint.created": "checkpoint.created";
        "checkpoint.restored": "checkpoint.restored";
        "error.occurred": "error.occurred";
        "job.cancelled": "job.cancelled";
        "job.completed": "job.completed";
        "job.created": "job.created";
        "job.failed": "job.failed";
        "job.progress": "job.progress";
        "job.started": "job.started";
        "policy.acknowledged": "policy.acknowledged";
        "policy.updated": "policy.updated";
        "session.ended": "session.ended";
        "session.started": "session.started";
        "tool.executed": "tool.executed";
        "tool.failed": "tool.failed";
    }>;
    timestamp: z.ZodString;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type Event = z.infer<typeof Event>;
/**
 * Event creation input
 */
export declare const EventCreate: z.ZodObject<{
    type: z.ZodEnum<{
        "approval.granted": "approval.granted";
        "approval.rejected": "approval.rejected";
        "approval.requested": "approval.requested";
        "checkpoint.created": "checkpoint.created";
        "checkpoint.restored": "checkpoint.restored";
        "error.occurred": "error.occurred";
        "job.cancelled": "job.cancelled";
        "job.completed": "job.completed";
        "job.created": "job.created";
        "job.failed": "job.failed";
        "job.progress": "job.progress";
        "job.started": "job.started";
        "policy.acknowledged": "policy.acknowledged";
        "policy.updated": "policy.updated";
        "session.ended": "session.ended";
        "session.started": "session.started";
        "tool.executed": "tool.executed";
        "tool.failed": "tool.failed";
    }>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type EventCreate = z.infer<typeof EventCreate>;
/**
 * Event filter for queries
 */
export declare const EventFilter: z.ZodObject<{
    types: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "approval.granted": "approval.granted";
        "approval.rejected": "approval.rejected";
        "approval.requested": "approval.requested";
        "checkpoint.created": "checkpoint.created";
        "checkpoint.restored": "checkpoint.restored";
        "error.occurred": "error.occurred";
        "job.cancelled": "job.cancelled";
        "job.completed": "job.completed";
        "job.created": "job.created";
        "job.failed": "job.failed";
        "job.progress": "job.progress";
        "job.started": "job.started";
        "policy.acknowledged": "policy.acknowledged";
        "policy.updated": "policy.updated";
        "session.ended": "session.ended";
        "session.started": "session.started";
        "tool.executed": "tool.executed";
        "tool.failed": "tool.failed";
    }>>>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EventFilter = z.infer<typeof EventFilter>;
