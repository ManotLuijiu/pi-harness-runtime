/**
 * Project schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Project status
 */
export declare const ProjectStatus: z.ZodEnum<{
    active: "active";
    archived: "archived";
    deleted: "deleted";
}>;
export type ProjectStatus = z.infer<typeof ProjectStatus>;
/**
 * Project definition
 */
export declare const Project: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        archived: "archived";
        deleted: "deleted";
    }>>;
    workspaceId: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    lastAccessedAt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type Project = z.infer<typeof Project>;
/**
 * Project creation input
 */
export declare const ProjectCreate: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    workspaceId: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type ProjectCreate = z.infer<typeof ProjectCreate>;
/**
 * Project update input
 */
export declare const ProjectUpdate: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        deleted: "deleted";
    }>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;
/**
 * Project filter
 */
export declare const ProjectFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        deleted: "deleted";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ProjectFilter = z.infer<typeof ProjectFilter>;
/**
 * Project list response
 */
export declare const ProjectList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
        status: z.ZodDefault<z.ZodEnum<{
            active: "active";
            archived: "archived";
            deleted: "deleted";
        }>>;
        workspaceId: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        lastAccessedAt: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ProjectList = z.infer<typeof ProjectList>;
