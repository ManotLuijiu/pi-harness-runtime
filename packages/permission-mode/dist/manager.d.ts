/**
 * Approval Manager
 *
 * Manages the approval workflow for pending actions.
 */
/**
 * Approval request interface
 */
export interface ApprovalRequest {
    type: string;
    workspaceId: string;
    sessionId: string;
    description: string;
    tool?: string;
    command?: string;
    file?: string;
    reason?: string;
    expiresIn?: number;
}
/**
 * Approval response interface
 */
export interface ApprovalResponse {
    id: string;
    approved: boolean;
    reason?: string;
}
/**
 * Pending approval entry
 */
export interface PendingApproval {
    id: string;
    request: ApprovalRequest;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    createdAt: Date;
    expiresAt?: Date;
    respondedAt?: Date;
}
/**
 * Approval manager options
 */
export interface ApprovalManagerOptions {
    defaultTimeout?: number;
    onApprovalRequest?: (approval: PendingApproval) => void;
    onApprovalGranted?: (approval: PendingApproval) => void;
    onApprovalRejected?: (approval: PendingApproval) => void;
    onApprovalExpired?: (approval: PendingApproval) => void;
}
/**
 * Approval Manager
 */
export declare class ApprovalManager {
    private pending;
    private options;
    constructor(options?: ApprovalManagerOptions);
    requestApproval(request: ApprovalRequest): PendingApproval;
    respond(response: ApprovalResponse): PendingApproval | null;
    getPending(): PendingApproval[];
    get(id: string): PendingApproval | undefined;
    hasPending(): boolean;
    countPending(): number;
    cancel(id: string): boolean;
    private checkExpiration;
    private generateId;
}
