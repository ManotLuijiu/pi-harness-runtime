/**
 * Project schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Project status
 */
export declare const ProjectStatus: z.ZodEnum<["active", "archived", "deleted"]>;
export type ProjectStatus = z.infer<typeof ProjectStatus>;
/**
 * Project definition
 */
export declare const Project: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<["active", "archived", "deleted"]>>;
    workspaceId: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    lastAccessedAt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    path: string;
    status: "active" | "archived" | "deleted";
    id: string;
    workspaceId: string;
    createdAt: string;
    name: string;
    updatedAt: string;
    metadata?: Record<string, unknown> | undefined;
    lastAccessedAt?: string | undefined;
}, {
    path: string;
    id: string;
    workspaceId: string;
    createdAt: string;
    name: string;
    updatedAt: string;
    status?: "active" | "archived" | "deleted" | undefined;
    metadata?: Record<string, unknown> | undefined;
    lastAccessedAt?: string | undefined;
}>;
export type Project = z.infer<typeof Project>;
/**
 * Project creation input
 */
export declare const ProjectCreate: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    workspaceId: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    path: string;
    workspaceId: string;
    name: string;
    metadata?: Record<string, unknown> | undefined;
}, {
    path: string;
    workspaceId: string;
    name: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export type ProjectCreate = z.infer<typeof ProjectCreate>;
/**
 * Project update input
 */
export declare const ProjectUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["active", "archived", "deleted"]>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "archived" | "deleted" | undefined;
    metadata?: Record<string, unknown> | undefined;
    name?: string | undefined;
}, {
    status?: "active" | "archived" | "deleted" | undefined;
    metadata?: Record<string, unknown> | undefined;
    name?: string | undefined;
}>;
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;
/**
 * Project filter
 */
export declare const ProjectFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["active", "archived", "deleted"]>>;
    search: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    status?: "active" | "archived" | "deleted" | undefined;
    workspaceId?: string | undefined;
    cursor?: string | undefined;
    search?: string | undefined;
}, {
    status?: "active" | "archived" | "deleted" | undefined;
    workspaceId?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
    search?: string | undefined;
}>;
export type ProjectFilter = z.infer<typeof ProjectFilter>;
/**
 * Project list response
 */
export declare const ProjectList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
        status: z.ZodDefault<z.ZodEnum<["active", "archived", "deleted"]>>;
        workspaceId: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        lastAccessedAt: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        status: "active" | "archived" | "deleted";
        id: string;
        workspaceId: string;
        createdAt: string;
        name: string;
        updatedAt: string;
        metadata?: Record<string, unknown> | undefined;
        lastAccessedAt?: string | undefined;
    }, {
        path: string;
        id: string;
        workspaceId: string;
        createdAt: string;
        name: string;
        updatedAt: string;
        status?: "active" | "archived" | "deleted" | undefined;
        metadata?: Record<string, unknown> | undefined;
        lastAccessedAt?: string | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        path: string;
        status: "active" | "archived" | "deleted";
        id: string;
        workspaceId: string;
        createdAt: string;
        name: string;
        updatedAt: string;
        metadata?: Record<string, unknown> | undefined;
        lastAccessedAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        path: string;
        id: string;
        workspaceId: string;
        createdAt: string;
        name: string;
        updatedAt: string;
        status?: "active" | "archived" | "deleted" | undefined;
        metadata?: Record<string, unknown> | undefined;
        lastAccessedAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type ProjectList = z.infer<typeof ProjectList>;
