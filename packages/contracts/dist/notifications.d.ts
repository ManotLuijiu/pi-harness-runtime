/**
 * Notification schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Notification channel
 */
export declare const NotificationChannel: z.ZodEnum<["telegram", "email", "webhook", "desktop"]>;
export type NotificationChannel = z.infer<typeof NotificationChannel>;
/**
 * Notification priority
 */
export declare const NotificationPriority: z.ZodEnum<["low", "normal", "high", "urgent"]>;
export type NotificationPriority = z.infer<typeof NotificationPriority>;
/**
 * Notification definition
 */
export declare const Notification: z.ZodObject<{
    id: z.ZodString;
    event: z.ZodString;
    channel: z.ZodEnum<["telegram", "email", "webhook", "desktop"]>;
    priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    message: z.ZodString;
    data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    buttons: z.ZodOptional<z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        action: z.ZodString;
        targetId: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }, {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }>, "many">>;
    sentAt: z.ZodOptional<z.ZodString>;
    readAt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    id: string;
    priority: "low" | "normal" | "high" | "urgent";
    event: string;
    channel: "telegram" | "email" | "webhook" | "desktop";
    title: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
    sentAt?: string | undefined;
    readAt?: string | undefined;
}, {
    message: string;
    id: string;
    event: string;
    channel: "telegram" | "email" | "webhook" | "desktop";
    title: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
    sentAt?: string | undefined;
    readAt?: string | undefined;
}>;
export type Notification = z.infer<typeof Notification>;
/**
 * Notification creation input
 */
export declare const NotificationCreate: z.ZodObject<{
    event: z.ZodString;
    channel: z.ZodDefault<z.ZodEnum<["telegram", "email", "webhook", "desktop"]>>;
    priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    message: z.ZodString;
    data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    buttons: z.ZodOptional<z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        action: z.ZodString;
        targetId: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }, {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }>, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    priority: "low" | "normal" | "high" | "urgent";
    event: string;
    channel: "telegram" | "email" | "webhook" | "desktop";
    title: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
}, {
    message: string;
    event: string;
    title: string;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
    channel?: "telegram" | "email" | "webhook" | "desktop" | undefined;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
}>;
export type NotificationCreate = z.infer<typeof NotificationCreate>;
/**
 * Notification filter
 */
export declare const NotificationFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    channel: z.ZodOptional<z.ZodEnum<["telegram", "email", "webhook", "desktop"]>>;
    priority: z.ZodOptional<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
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
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
    channel?: "telegram" | "email" | "webhook" | "desktop" | undefined;
}, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
    priority?: "low" | "normal" | "high" | "urgent" | undefined;
    channel?: "telegram" | "email" | "webhook" | "desktop" | undefined;
}>;
export type NotificationFilter = z.infer<typeof NotificationFilter>;
/**
 * Notification list response
 */
export declare const NotificationList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        event: z.ZodString;
        channel: z.ZodEnum<["telegram", "email", "webhook", "desktop"]>;
        priority: z.ZodDefault<z.ZodEnum<["low", "normal", "high", "urgent"]>>;
        workspaceId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        jobId: z.ZodOptional<z.ZodString>;
        title: z.ZodString;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        buttons: z.ZodOptional<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            action: z.ZodString;
            targetId: z.ZodOptional<z.ZodString>;
            url: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }, {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }>, "many">>;
        sentAt: z.ZodOptional<z.ZodString>;
        readAt: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        id: string;
        priority: "low" | "normal" | "high" | "urgent";
        event: string;
        channel: "telegram" | "email" | "webhook" | "desktop";
        title: string;
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
    }, {
        message: string;
        id: string;
        event: string;
        channel: "telegram" | "email" | "webhook" | "desktop";
        title: string;
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        priority?: "low" | "normal" | "high" | "urgent" | undefined;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        message: string;
        id: string;
        priority: "low" | "normal" | "high" | "urgent";
        event: string;
        channel: "telegram" | "email" | "webhook" | "desktop";
        title: string;
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        message: string;
        id: string;
        event: string;
        channel: "telegram" | "email" | "webhook" | "desktop";
        title: string;
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        priority?: "low" | "normal" | "high" | "urgent" | undefined;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type NotificationList = z.infer<typeof NotificationList>;
