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
    id: string;
    event: string;
    channel: "desktop" | "email" | "telegram" | "webhook";
    priority: "high" | "low" | "normal" | "urgent";
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    title: string;
    message: string;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
    sentAt?: string | undefined;
    readAt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    id: string;
    event: string;
    channel: "desktop" | "email" | "telegram" | "webhook";
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    title: string;
    message: string;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
    sentAt?: string | undefined;
    readAt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
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
    event: string;
    channel: "desktop" | "email" | "telegram" | "webhook";
    priority: "high" | "low" | "normal" | "urgent";
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    title: string;
    message: string;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    event: string;
    channel?: "desktop" | "email" | "telegram" | "webhook" | undefined;
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    title: string;
    message: string;
    data?: Record<string, unknown> | undefined;
    buttons?: {
        text: string;
        action: string;
        targetId?: string | undefined;
        url?: string | undefined;
    }[] | undefined;
    metadata?: Record<string, unknown> | undefined;
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
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    channel?: "desktop" | "email" | "telegram" | "webhook" | undefined;
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit: number;
    cursor?: string | undefined;
}, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    channel?: "desktop" | "email" | "telegram" | "webhook" | undefined;
    priority?: "high" | "low" | "normal" | "urgent" | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
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
        id: string;
        event: string;
        channel: "desktop" | "email" | "telegram" | "webhook";
        priority: "high" | "low" | "normal" | "urgent";
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        title: string;
        message: string;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        id: string;
        event: string;
        channel: "desktop" | "email" | "telegram" | "webhook";
        priority?: "high" | "low" | "normal" | "urgent" | undefined;
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        title: string;
        message: string;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        id: string;
        event: string;
        channel: "desktop" | "email" | "telegram" | "webhook";
        priority: "high" | "low" | "normal" | "urgent";
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        title: string;
        message: string;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        id: string;
        event: string;
        channel: "desktop" | "email" | "telegram" | "webhook";
        priority?: "high" | "low" | "normal" | "urgent" | undefined;
        workspaceId?: string | undefined;
        sessionId?: string | undefined;
        jobId?: string | undefined;
        title: string;
        message: string;
        data?: Record<string, unknown> | undefined;
        buttons?: {
            text: string;
            action: string;
            targetId?: string | undefined;
            url?: string | undefined;
        }[] | undefined;
        sentAt?: string | undefined;
        readAt?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type NotificationList = z.infer<typeof NotificationList>;
