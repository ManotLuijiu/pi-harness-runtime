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
    type: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    id: string;
    workspaceId: string;
    priority: "low" | "normal" | "high" | "urgent";
    requirement: string;
    progress: number;
    createdAt: string;
    sessionId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    result?: unknown;
    error?: string | undefined;
    startedAt?: string | undefined;
    completedAt?: string | undefined;
}, {
    type: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    id: string;
    workspaceId: string;
    requirement: string;
    createdAt: string;
    sessionId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
    result?: unknown;
    error?: string | undefined;
    progress?: number | undefined;
    startedAt?: string | undefined;
    completedAt?: string | undefined;
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
    workspaceId: string;
    priority: "low" | "normal" | "high" | "urgent";
    requirement: string;
    sessionId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    type: string;
    workspaceId: string;
    requirement: string;
    sessionId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
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
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | undefined;
    result?: unknown;
    error?: string | undefined;
    progress?: number | undefined;
}, {
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | undefined;
    result?: unknown;
    error?: string | undefined;
    progress?: number | undefined;
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
    limit: number;
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | ("pending" | "running" | "completed" | "failed" | "cancelled")[] | undefined;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    cursor?: string | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
}, {
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | ("pending" | "running" | "completed" | "failed" | "cancelled")[] | undefined;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
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
        type: string;
        status: "pending" | "running" | "completed" | "failed" | "cancelled";
        id: string;
        workspaceId: string;
        priority: "low" | "normal" | "high" | "urgent";
        requirement: string;
        progress: number;
        createdAt: string;
        sessionId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        result?: unknown;
        error?: string | undefined;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
    }, {
        type: string;
        status: "pending" | "running" | "completed" | "failed" | "cancelled";
        id: string;
        workspaceId: string;
        requirement: string;
        createdAt: string;
        sessionId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        priority?: "low" | "normal" | "high" | "urgent" | undefined;
        result?: unknown;
        error?: string | undefined;
        progress?: number | undefined;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        type: string;
        status: "pending" | "running" | "completed" | "failed" | "cancelled";
        id: string;
        workspaceId: string;
        priority: "low" | "normal" | "high" | "urgent";
        requirement: string;
        progress: number;
        createdAt: string;
        sessionId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        result?: unknown;
        error?: string | undefined;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        type: string;
        status: "pending" | "running" | "completed" | "failed" | "cancelled";
        id: string;
        workspaceId: string;
        requirement: string;
        createdAt: string;
        sessionId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        priority?: "low" | "normal" | "high" | "urgent" | undefined;
        result?: unknown;
        error?: string | undefined;
        progress?: number | undefined;
        startedAt?: string | undefined;
        completedAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type JobList = z.infer<typeof JobList>;
