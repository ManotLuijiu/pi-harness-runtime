/**
 * Session schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Session status
 */
export declare const SessionStatus: z.ZodEnum<["active", "idle", "suspended", "ended"]>;
export type SessionStatus = z.infer<typeof SessionStatus>;
/**
 * Session type
 */
export declare const SessionType: z.ZodEnum<["interactive", "batch", "background", "review"]>;
export type SessionType = z.infer<typeof SessionType>;
/**
 * Session definition
 */
export declare const Session: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["interactive", "batch", "background", "review"]>;
    status: z.ZodEnum<["active", "idle", "suspended", "ended"]>;
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
}, "strip", z.ZodTypeAny, {
    type: "interactive" | "batch" | "background" | "review";
    status: "active" | "idle" | "suspended" | "ended";
    id: string;
    workspaceId: string;
    startedAt: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    metadata?: Record<string, unknown> | undefined;
    model?: string | undefined;
    endedAt?: string | undefined;
    lastActivityAt?: string | undefined;
}, {
    type: "interactive" | "batch" | "background" | "review";
    status: "active" | "idle" | "suspended" | "ended";
    id: string;
    workspaceId: string;
    startedAt: string;
    provider: string;
    metadata?: Record<string, unknown> | undefined;
    model?: string | undefined;
    endedAt?: string | undefined;
    lastActivityAt?: string | undefined;
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    cost?: number | undefined;
}>;
export type Session = z.infer<typeof Session>;
/**
 * Session creation input
 */
export declare const SessionCreate: z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<["interactive", "batch", "background", "review"]>>;
    workspaceId: z.ZodString;
    provider: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "interactive" | "batch" | "background" | "review";
    workspaceId: string;
    provider: string;
    metadata?: Record<string, unknown> | undefined;
    model?: string | undefined;
}, {
    workspaceId: string;
    provider: string;
    type?: "interactive" | "batch" | "background" | "review" | undefined;
    metadata?: Record<string, unknown> | undefined;
    model?: string | undefined;
}>;
export type SessionCreate = z.infer<typeof SessionCreate>;
/**
 * Session update input
 */
export declare const SessionUpdate: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["active", "idle", "suspended", "ended"]>>;
    lastActivityAt: z.ZodOptional<z.ZodString>;
    promptTokens: z.ZodOptional<z.ZodNumber>;
    completionTokens: z.ZodOptional<z.ZodNumber>;
    cost: z.ZodOptional<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "idle" | "suspended" | "ended" | undefined;
    metadata?: Record<string, unknown> | undefined;
    lastActivityAt?: string | undefined;
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    cost?: number | undefined;
}, {
    status?: "active" | "idle" | "suspended" | "ended" | undefined;
    metadata?: Record<string, unknown> | undefined;
    lastActivityAt?: string | undefined;
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    cost?: number | undefined;
}>;
export type SessionUpdate = z.infer<typeof SessionUpdate>;
/**
 * Session filter
 */
export declare const SessionFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["interactive", "batch", "background", "review"]>>;
    status: z.ZodOptional<z.ZodEnum<["active", "idle", "suspended", "ended"]>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    type?: "interactive" | "batch" | "background" | "review" | undefined;
    status?: "active" | "idle" | "suspended" | "ended" | undefined;
    workspaceId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    cursor?: string | undefined;
}, {
    type?: "interactive" | "batch" | "background" | "review" | undefined;
    status?: "active" | "idle" | "suspended" | "ended" | undefined;
    workspaceId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
}>;
export type SessionFilter = z.infer<typeof SessionFilter>;
/**
 * Session list response
 */
export declare const SessionList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["interactive", "batch", "background", "review"]>;
        status: z.ZodEnum<["active", "idle", "suspended", "ended"]>;
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
    }, "strip", z.ZodTypeAny, {
        type: "interactive" | "batch" | "background" | "review";
        status: "active" | "idle" | "suspended" | "ended";
        id: string;
        workspaceId: string;
        startedAt: string;
        provider: string;
        promptTokens: number;
        completionTokens: number;
        cost: number;
        metadata?: Record<string, unknown> | undefined;
        model?: string | undefined;
        endedAt?: string | undefined;
        lastActivityAt?: string | undefined;
    }, {
        type: "interactive" | "batch" | "background" | "review";
        status: "active" | "idle" | "suspended" | "ended";
        id: string;
        workspaceId: string;
        startedAt: string;
        provider: string;
        metadata?: Record<string, unknown> | undefined;
        model?: string | undefined;
        endedAt?: string | undefined;
        lastActivityAt?: string | undefined;
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        cost?: number | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        type: "interactive" | "batch" | "background" | "review";
        status: "active" | "idle" | "suspended" | "ended";
        id: string;
        workspaceId: string;
        startedAt: string;
        provider: string;
        promptTokens: number;
        completionTokens: number;
        cost: number;
        metadata?: Record<string, unknown> | undefined;
        model?: string | undefined;
        endedAt?: string | undefined;
        lastActivityAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        type: "interactive" | "batch" | "background" | "review";
        status: "active" | "idle" | "suspended" | "ended";
        id: string;
        workspaceId: string;
        startedAt: string;
        provider: string;
        metadata?: Record<string, unknown> | undefined;
        model?: string | undefined;
        endedAt?: string | undefined;
        lastActivityAt?: string | undefined;
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        cost?: number | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type SessionList = z.infer<typeof SessionList>;
