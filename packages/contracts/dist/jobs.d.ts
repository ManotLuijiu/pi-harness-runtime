/**
 * Job schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Job status
 */
export declare const JobStatus: z.ZodEnum<{
    cancelled: "cancelled";
    completed: "completed";
    failed: "failed";
    pending: "pending";
    running: "running";
}>;
export type JobStatus = z.infer<typeof JobStatus>;
/**
 * Job priority
 */
export declare const JobPriority: z.ZodEnum<{
    high: "high";
    low: "low";
    normal: "normal";
    urgent: "urgent";
}>;
export type JobPriority = z.infer<typeof JobPriority>;
/**
 * Job definition
 */
export declare const Job: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        completed: "completed";
        failed: "failed";
        pending: "pending";
        running: "running";
    }>;
    priority: z.ZodDefault<z.ZodEnum<{
        high: "high";
        low: "low";
        normal: "normal";
        urgent: "urgent";
    }>>;
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
}, z.core.$strip>;
export type Job = z.infer<typeof Job>;
/**
 * Job creation input
 */
export declare const JobCreate: z.ZodObject<{
    type: z.ZodString;
    priority: z.ZodDefault<z.ZodEnum<{
        high: "high";
        low: "low";
        normal: "normal";
        urgent: "urgent";
    }>>;
    workspaceId: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    requirement: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type JobCreate = z.infer<typeof JobCreate>;
/**
 * Job update input
 */
export declare const JobUpdate: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        cancelled: "cancelled";
        completed: "completed";
        failed: "failed";
        pending: "pending";
        running: "running";
    }>>;
    progress: z.ZodOptional<z.ZodNumber>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type JobUpdate = z.infer<typeof JobUpdate>;
/**
 * Job filter
 */
export declare const JobFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        cancelled: "cancelled";
        completed: "completed";
        failed: "failed";
        pending: "pending";
        running: "running";
    }>, z.ZodArray<z.ZodEnum<{
        cancelled: "cancelled";
        completed: "completed";
        failed: "failed";
        pending: "pending";
        running: "running";
    }>>]>>;
    priority: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        normal: "normal";
        urgent: "urgent";
    }>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type JobFilter = z.infer<typeof JobFilter>;
/**
 * Job list response
 */
export declare const JobList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            pending: "pending";
            running: "running";
        }>;
        priority: z.ZodDefault<z.ZodEnum<{
            high: "high";
            low: "low";
            normal: "normal";
            urgent: "urgent";
        }>>;
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
    }, z.core.$strip>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type JobList = z.infer<typeof JobList>;
