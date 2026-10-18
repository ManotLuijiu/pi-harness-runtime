/**
 * Approval schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Approval status
 */
export declare const ApprovalStatus: z.ZodEnum<["pending", "approved", "rejected", "expired"]>;
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
/**
 * Approval type
 */
export declare const ApprovalType: z.ZodEnum<["tool_execution", "file_write", "file_delete", "command_execution", "network_request", "external_action"]>;
export type ApprovalType = z.infer<typeof ApprovalType>;
/**
 * Approval definition
 */
export declare const Approval: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["tool_execution", "file_write", "file_delete", "command_execution", "network_request", "external_action"]>;
    status: z.ZodDefault<z.ZodEnum<["pending", "approved", "rejected", "expired"]>>;
    workspaceId: z.ZodString;
    sessionId: z.ZodString;
    jobId: z.ZodOptional<z.ZodString>;
    tool: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
    file: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
    requestedAt: z.ZodString;
    respondedAt: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodString>;
    requestedBy: z.ZodString;
    approvedBy: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
    status: "approved" | "expired" | "pending" | "rejected";
    workspaceId: string;
    sessionId: string;
    jobId?: string | undefined;
    tool?: string | undefined;
    command?: string | undefined;
    file?: string | undefined;
    description: string;
    reason?: string | undefined;
    requestedAt: string;
    respondedAt?: string | undefined;
    expiresAt?: string | undefined;
    requestedBy: string;
    approvedBy?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    id: string;
    type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
    status?: "approved" | "expired" | "pending" | "rejected" | undefined;
    workspaceId: string;
    sessionId: string;
    jobId?: string | undefined;
    tool?: string | undefined;
    command?: string | undefined;
    file?: string | undefined;
    description: string;
    reason?: string | undefined;
    requestedAt: string;
    respondedAt?: string | undefined;
    expiresAt?: string | undefined;
    requestedBy: string;
    approvedBy?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type Approval = z.infer<typeof Approval>;
/**
 * Approval request input
 */
export declare const ApprovalRequest: z.ZodObject<{
    type: z.ZodEnum<["tool_execution", "file_write", "file_delete", "command_execution", "network_request", "external_action"]>;
    workspaceId: z.ZodString;
    sessionId: z.ZodString;
    jobId: z.ZodOptional<z.ZodString>;
    tool: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
    file: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
    expiresIn: z.ZodOptional<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
    workspaceId: string;
    sessionId: string;
    jobId?: string | undefined;
    tool?: string | undefined;
    command?: string | undefined;
    file?: string | undefined;
    description: string;
    reason?: string | undefined;
    expiresIn?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
    workspaceId: string;
    sessionId: string;
    jobId?: string | undefined;
    tool?: string | undefined;
    command?: string | undefined;
    file?: string | undefined;
    description: string;
    reason?: string | undefined;
    expiresIn?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
/**
 * Approval response input
 */
export declare const ApprovalResponse: z.ZodObject<{
    id: z.ZodString;
    approved: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    approved: boolean;
    reason?: string | undefined;
}, {
    id: string;
    approved: boolean;
    reason?: string | undefined;
}>;
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;
/**
 * Approval filter
 */
export declare const ApprovalFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["pending", "approved", "rejected", "expired"]>>;
    type: z.ZodOptional<z.ZodEnum<["tool_execution", "file_write", "file_delete", "command_execution", "network_request", "external_action"]>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    status?: "approved" | "expired" | "pending" | "rejected" | undefined;
    type?: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution" | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit: number;
    cursor?: string | undefined;
}, {
    workspaceId?: string | undefined;
    sessionId?: string | undefined;
    jobId?: string | undefined;
    status?: "approved" | "expired" | "pending" | "rejected" | undefined;
    type?: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution" | undefined;
    since?: string | undefined;
    until?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
}>;
export type ApprovalFilter = z.infer<typeof ApprovalFilter>;
/**
 * Approval list response
 */
export declare const ApprovalList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["tool_execution", "file_write", "file_delete", "command_execution", "network_request", "external_action"]>;
        status: z.ZodDefault<z.ZodEnum<["pending", "approved", "rejected", "expired"]>>;
        workspaceId: z.ZodString;
        sessionId: z.ZodString;
        jobId: z.ZodOptional<z.ZodString>;
        tool: z.ZodOptional<z.ZodString>;
        command: z.ZodOptional<z.ZodString>;
        file: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
        requestedAt: z.ZodString;
        respondedAt: z.ZodOptional<z.ZodString>;
        expiresAt: z.ZodOptional<z.ZodString>;
        requestedBy: z.ZodString;
        approvedBy: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
        status: "approved" | "expired" | "pending" | "rejected";
        workspaceId: string;
        sessionId: string;
        jobId?: string | undefined;
        tool?: string | undefined;
        command?: string | undefined;
        file?: string | undefined;
        description: string;
        reason?: string | undefined;
        requestedAt: string;
        respondedAt?: string | undefined;
        expiresAt?: string | undefined;
        requestedBy: string;
        approvedBy?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        id: string;
        type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
        status?: "approved" | "expired" | "pending" | "rejected" | undefined;
        workspaceId: string;
        sessionId: string;
        jobId?: string | undefined;
        tool?: string | undefined;
        command?: string | undefined;
        file?: string | undefined;
        description: string;
        reason?: string | undefined;
        requestedAt: string;
        respondedAt?: string | undefined;
        expiresAt?: string | undefined;
        requestedBy: string;
        approvedBy?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>, "many">;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    items: {
        id: string;
        type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
        status: "approved" | "expired" | "pending" | "rejected";
        workspaceId: string;
        sessionId: string;
        jobId?: string | undefined;
        tool?: string | undefined;
        command?: string | undefined;
        file?: string | undefined;
        description: string;
        reason?: string | undefined;
        requestedAt: string;
        respondedAt?: string | undefined;
        expiresAt?: string | undefined;
        requestedBy: string;
        approvedBy?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}, {
    items: {
        id: string;
        type: "command_execution" | "external_action" | "file_delete" | "file_write" | "network_request" | "tool_execution";
        status?: "approved" | "expired" | "pending" | "rejected" | undefined;
        workspaceId: string;
        sessionId: string;
        jobId?: string | undefined;
        tool?: string | undefined;
        command?: string | undefined;
        file?: string | undefined;
        description: string;
        reason?: string | undefined;
        requestedAt: string;
        respondedAt?: string | undefined;
        expiresAt?: string | undefined;
        requestedBy: string;
        approvedBy?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }[];
    nextCursor?: string | undefined;
    total?: number | undefined;
}>;
export type ApprovalList = z.infer<typeof ApprovalList>;
