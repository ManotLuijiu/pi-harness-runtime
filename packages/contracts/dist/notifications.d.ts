/**
 * Notification schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Notification channel
 */
export declare const NotificationChannel: z.ZodEnum<{
    desktop: "desktop";
    email: "email";
    telegram: "telegram";
    webhook: "webhook";
}>;
export type NotificationChannel = z.infer<typeof NotificationChannel>;
/**
 * Notification priority
 */
export declare const NotificationPriority: z.ZodEnum<{
    high: "high";
    low: "low";
    normal: "normal";
    urgent: "urgent";
}>;
export type NotificationPriority = z.infer<typeof NotificationPriority>;
/**
 * Notification definition
 */
export declare const Notification: z.ZodObject<{
    id: z.ZodString;
    event: z.ZodString;
    channel: z.ZodEnum<{
        desktop: "desktop";
        email: "email";
        telegram: "telegram";
        webhook: "webhook";
    }>;
    priority: z.ZodDefault<z.ZodEnum<{
        high: "high";
        low: "low";
        normal: "normal";
        urgent: "urgent";
    }>>;
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
    }, z.core.$strip>>>;
    sentAt: z.ZodOptional<z.ZodString>;
    readAt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type Notification = z.infer<typeof Notification>;
/**
 * Notification creation input
 */
export declare const NotificationCreate: z.ZodObject<{
    event: z.ZodString;
    channel: z.ZodDefault<z.ZodEnum<{
        desktop: "desktop";
        email: "email";
        telegram: "telegram";
        webhook: "webhook";
    }>>;
    priority: z.ZodDefault<z.ZodEnum<{
        high: "high";
        low: "low";
        normal: "normal";
        urgent: "urgent";
    }>>;
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
    }, z.core.$strip>>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type NotificationCreate = z.infer<typeof NotificationCreate>;
/**
 * Notification filter
 */
export declare const NotificationFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    channel: z.ZodOptional<z.ZodEnum<{
        desktop: "desktop";
        email: "email";
        telegram: "telegram";
        webhook: "webhook";
    }>>;
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
export type NotificationFilter = z.infer<typeof NotificationFilter>;
/**
 * Notification list response
 */
export declare const NotificationList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        event: z.ZodString;
        channel: z.ZodEnum<{
            desktop: "desktop";
            email: "email";
            telegram: "telegram";
            webhook: "webhook";
        }>;
        priority: z.ZodDefault<z.ZodEnum<{
            high: "high";
            low: "low";
            normal: "normal";
            urgent: "urgent";
        }>>;
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
        }, z.core.$strip>>>;
        sentAt: z.ZodOptional<z.ZodString>;
        readAt: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type NotificationList = z.infer<typeof NotificationList>;
