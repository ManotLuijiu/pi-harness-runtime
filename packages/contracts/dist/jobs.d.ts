/**
 * Job schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Job status
 */
export declare const JobStatus: z.ZodEnum<["pending", "running", "completed", "failed", "cancelled"]>;
export type JobStatus = z.infer<typeof JobStatus>;
/**
 * Job priority
 */
export declare const JobPriority: z.ZodEnum<["low", "normal", "high", "urgent"]>;
export type JobPriority = z.infer<typeof JobPriority>;
/**
 * Job definition
 */
export declare const Job: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    status: z.ZodEnum<["pending", "running", "completed", "failed", "cancelled"]>;
    priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
    workspaceId: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    requirement: z.ZodString;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
    progress: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    completedAt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    type: string;
    status: "cancelled" | "completed" | "failed" | "pending" | "running";
    priority: "high" | "low" | "normal" | "urgent";
    workspaceId: string;
    sessionId?: string | undefined;
    requirement: string;
    result?: unknown;
    error?: string | undefined;
    progress: number;
    createdAt: string;
    startedAt?: string | undefined;
    completedAt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    id: string;
    type: string;
    status: "cancelled" | "completed" | "failed" | "pending" | "running";
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    workspaceId: string;
    sessionId?: string | undefined;
    requirement: string;
    result?: unknown;
    error?: string | undefined;
    progress?: number | undefined;
    createdAt: string;
    startedAt?: string | undefined;
    completedAt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type Job = z.infer<typeof Job>;
/**
 * Job creation input
 */
export declare const JobCreate: z.ZodObject<{
    type: z.ZodString;
    priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
    workspaceId: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    requirement: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: string;
    priority: "high" | "low" | "normal" | "urgent";
    workspaceId: string;
    sessionId?: string | undefined;
    requirement: string;
    metadata?: Record<string, unknown> | undefined;
}, {
    type: string;
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    workspaceId: string;
    sessionId?: string | undefined;
    requirement: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export type JobCreate = z.infer<typeof JobCreate>;
/**
 * Job update input
 */
export declare const JobUpdate: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["pending", "running", "completed", "failed", "cancelled"]>>;
    progress: z.ZodOptional<z.ZodNumber>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status?: "cancelled" | "completed" | "failed" | "pending" | "running" | undefined;
    progress?: number | undefined;
    result?: unknown;
    error?: string | undefined;
}, {
    status?: "cancelled" | "completed" | "failed" | "pending" | "running" | undefined;
    progress?: number | undefined;
    result?: unknown;
    error?: string | undefined;
}>;
export type JobUpdate = z.infer<typeof JobUpdate>;
/**
 * Job filter
 */
export declare const JobFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodUnion<[z.ZodEnum<["pending", "running", "completed", "failed", "cancelled"]>, z.ZodArray<z.ZodEnum<["pending", "running", "completed", "failed", "cancelled"]>, "many">]>>;
    priority: z.ZodOptional<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    status?: "cancelled" | "completed" | "failed" | "pending" | "running" | ("cancelled" | "completed" | "failed" | "pending" | "running")[] | undefined;
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit: number;
    cursor?: string | undefined;
}, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    status?: "cancelled" | "completed" | "failed" | "pending" | "running" | ("cancelled" | "completed" | "failed" | "pending" | "running")[] | undefined;
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
}>;
export type JobFilter = z.infer<typeof JobFilter>;
/**
 * Job list response
 */
export declare const JobList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        status: z.ZodEnum<["pending", "running", "completed", "failed", "cancelled"]>;
        priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
        workspaceId: z.ZodString;
        sessionId: z.ZodOptional<z.ZodString>;
        requirement: z.ZodString;
        result: z.ZodOptional<z.ZodUnknown>;
        error: z.ZodOptional<z.ZodString>;
        progress: z.ZodDefault<z.ZodNumber>;
        createdAt: z.ZodString;
        startedAt: z.ZodOptional<z.ZodString>;
        completedAt: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        type: string;
        status: "cancelled" | "completed" | "failed" | "pending" | "running";
        priority: "high" | "low" | "normal" | "urgent";
        workspaceId: string;
        sessionId?: string | undefined;
        requirement: string;
        result?: unknown;
        error?: string | undefined;
        progress: number;
        createdAt: string;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        id: string;
        type: string;
        status: "cancelled" | "completed" | "failed" | "pending" | "running";
        priority?: "high" | "low" | "normal" | "urgent" | undefined;
        workspaceId: string;
        sessionId?: string | undefined;
        requirement: string;
        result?: unknown;
        error?: string | undefined;
        progress?: number | undefined;
        createdAt: string;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        id: string;
        type: string;
        status: "cancelled" | "completed" | "failed" | "pending" | "running";
        priority: "high" | "low" | "normal" | "urgent";
        workspaceId: string;
        sessionId?: string | undefined;
        requirement: string;
        result?: unknown;
        error?: string | undefined;
        progress: number;
        createdAt: string;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        id: string;
        type: string;
        status: "cancelled" | "completed" | "failed" | "pending" | "running";
        priority?: "high" | "low" | "normal" | "urgent" | undefined;
        workspaceId: string;
        sessionId?: string | undefined;
        requirement: string;
        result?: unknown;
        error?: string | undefined;
        progress?: number | undefined;
        createdAt: string;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type JobList = z.infer<typeof JobList>;
