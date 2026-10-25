/**
 * Approval schemas for pi-harness
 */
import { z } from 'zod';
/**
 * Approval status
 */
export declare const ApprovalStatus: z.ZodEnum<{
    approved: "approved";
    expired: "expired";
    pending: "pending";
    rejected: "rejected";
}>;
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
/**
 * Approval type
 */
export declare const ApprovalType: z.ZodEnum<{
    command_execution: "command_execution";
    external_action: "external_action";
    file_delete: "file_delete";
    file_write: "file_write";
    network_request: "network_request";
    tool_execution: "tool_execution";
}>;
export type ApprovalType = z.infer<typeof ApprovalType>;
/**
 * Approval definition
 */
export declare const Approval: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<{
        command_execution: "command_execution";
        external_action: "external_action";
        file_delete: "file_delete";
        file_write: "file_write";
        network_request: "network_request";
        tool_execution: "tool_execution";
    }>;
    status: z.ZodDefault<z.ZodEnum<{
        approved: "approved";
        expired: "expired";
        pending: "pending";
        rejected: "rejected";
    }>>;
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
}, z.core.$strip>;
export type Approval = z.infer<typeof Approval>;
/**
 * Approval request input
 */
export declare const ApprovalRequest: z.ZodObject<{
    type: z.ZodEnum<{
        command_execution: "command_execution";
        external_action: "external_action";
        file_delete: "file_delete";
        file_write: "file_write";
        network_request: "network_request";
        tool_execution: "tool_execution";
    }>;
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
}, z.core.$strip>;
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
/**
 * Approval response input
 */
export declare const ApprovalResponse: z.ZodObject<{
    id: z.ZodString;
    approved: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;
/**
 * Approval filter
 */
export declare const ApprovalFilter: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    jobId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        approved: "approved";
        expired: "expired";
        pending: "pending";
        rejected: "rejected";
    }>>;
    type: z.ZodOptional<z.ZodEnum<{
        command_execution: "command_execution";
        external_action: "external_action";
        file_delete: "file_delete";
        file_write: "file_write";
        network_request: "network_request";
        tool_execution: "tool_execution";
    }>>;
    since: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ApprovalFilter = z.infer<typeof ApprovalFilter>;
/**
 * Approval list response
 */
export declare const ApprovalList: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<{
            command_execution: "command_execution";
            external_action: "external_action";
            file_delete: "file_delete";
            file_write: "file_write";
            network_request: "network_request";
            tool_execution: "tool_execution";
        }>;
        status: z.ZodDefault<z.ZodEnum<{
            approved: "approved";
            expired: "expired";
            pending: "pending";
            rejected: "rejected";
        }>>;
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
    }, z.core.$strip>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ApprovalList = z.infer<typeof ApprovalList>;
