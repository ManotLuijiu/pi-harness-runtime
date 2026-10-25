/**
 * Session schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Session status
 */
export declare const SessionStatus: z.ZodEnum<{
    active: "active";
    ended: "ended";
    idle: "idle";
    suspended: "suspended";
}>;
export type SessionStatus = z.infer<typeof SessionStatus>;
/**
 * Session type
 */
export declare const SessionType: z.ZodEnum<{
    background: "background";
    batch: "batch";
    interactive: "interactive";
    review: "review";
}>;
export type SessionType = z.infer<typeof SessionType>;
/**
 * Session definition
 */
export declare const Session: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<{
        background: "background";
        batch: "batch";
        interactive: "interactive";
        review: "review";
    }>;
    status: z.ZodEnum<{
        active: "active";
        ended: "ended";
        idle: "idle";
        suspended: "suspended";
    }>;
    workspaceId: z.ZodString;
    provider: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodString;
    endedAt: z.ZodOptional<z.ZodString>;
    lastActivityAt: z.ZodOptional<z.ZodString>;
    promptTokens: z.ZodDefault<z.ZodNumber>;
    completionTokens: z.ZodDefault<z.ZodNumber>;
    cost: z.ZodDefault<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type Session = z.infer<typeof Session>;
/**
 * Session creation input
 */
export declare const SessionCreate: z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<{
        background: "background";
        batch: "batch";
        interactive: "interactive";
        review: "review";
    }>>;
    workspaceId: z.ZodString;
    provider: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type SessionCreate = z.infer<typeof SessionCreate>;
/**
 * Session update input
 */
export declare const SessionUpdate: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        ended: "ended";
        idle: "idle";
        suspended: "suspended";
    }>>;
    lastActivityAt: z.ZodOptional<z.ZodString>;
    promptTokens: z.ZodOptional<z.ZodNumber>;
    completionTokens: z.ZodOptional<z.ZodNumber>;
    cost: z.ZodOptional<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type SessionUpdate = z.infer<typeof SessionUpdate>;
/**
 * Session filter
 */
export declare const SessionFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<{
        background: "background";
        batch: "batch";
        interactive: "interactive";
        review: "review";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        ended: "ended";
        idle: "idle";
        suspended: "suspended";
    }>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SessionFilter = z.infer<typeof SessionFilter>;
/**
 * Session list response
 */
export declare const SessionList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<{
            background: "background";
            batch: "batch";
            interactive: "interactive";
            review: "review";
        }>;
        status: z.ZodEnum<{
            active: "active";
            ended: "ended";
            idle: "idle";
            suspended: "suspended";
        }>;
        workspaceId: z.ZodString;
        provider: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        startedAt: z.ZodString;
        endedAt: z.ZodOptional<z.ZodString>;
        lastActivityAt: z.ZodOptional<z.ZodString>;
        promptTokens: z.ZodDefault<z.ZodNumber>;
        completionTokens: z.ZodDefault<z.ZodNumber>;
        cost: z.ZodDefault<z.ZodNumber>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type SessionList = z.infer<typeof SessionList>;
