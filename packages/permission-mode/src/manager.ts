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
export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private options: Required<ApprovalManagerOptions>;

  constructor(options: ApprovalManagerOptions = {}) {
    this.options = {
      defaultTimeout: options.defaultTimeout ?? 300,
      onApprovalRequest: options.onApprovalRequest ?? (() => {}),
      onApprovalGranted: options.onApprovalGranted ?? (() => {}),
      onApprovalRejected: options.onApprovalRejected ?? (() => {}),
      onApprovalExpired: options.onApprovalExpired ?? (() => {}),
    };
  }

  requestApproval(request: ApprovalRequest): PendingApproval {
    const id = this.generateId();
    const createdAt = new Date();
    const timeoutSeconds = request.expiresIn ?? this.options.defaultTimeout;
    const expiresAt = new Date(createdAt.getTime() + timeoutSeconds * 1000);

    const approval: PendingApproval = { id, request, status: 'pending', createdAt, expiresAt };
    this.pending.set(id, approval);
    this.options.onApprovalRequest(approval);

    if (timeoutSeconds > 0) {
      // SAFETY: globalThis always has setTimeout in JS runtimes (browsers, Node.js)
      const global = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void };
      global.setTimeout(() => this.checkExpiration(id), timeoutSeconds * 1000);
    }

    return approval;
  }

  respond(response: ApprovalResponse): PendingApproval | null {
    const approval = this.pending.get(response.id);
    if (!approval) return null;

    approval.status = response.approved ? 'approved' : 'rejected';
    approval.respondedAt = new Date();

    if (response.approved) {
      this.options.onApprovalGranted(approval);
    } else {
      this.options.onApprovalRejected(approval);
    }

    // Remove from pending after a short delay
    // SAFETY: globalThis always has setTimeout in JS runtimes
    const global = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void };
    global.setTimeout(() => this.pending.delete(response.id), 1000);

    return approval;
  }

  getPending(): PendingApproval[] {
    return Array.from(this.pending.values()).filter(a => a.status === 'pending');
  }

  get(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  hasPending(): boolean {
    return this.getPending().length > 0;
  }

  countPending(): number {
    return this.getPending().length;
  }

  cancel(id: string): boolean {
    const approval = this.pending.get(id);
    if (approval && approval.status === 'pending') {
      approval.status = 'rejected';
      approval.respondedAt = new Date();
      this.options.onApprovalRejected(approval);
      return true;
    }
    return false;
  }

  private checkExpiration(id: string): void {
    const approval = this.pending.get(id);
    if (approval && approval.status === 'pending') {
      const now = new Date();
      if (approval.expiresAt && now >= approval.expiresAt) {
        approval.status = 'expired';
        approval.respondedAt = now;
        this.pending.delete(id);
        this.options.onApprovalExpired(approval);
      }
    }
  }

  private generateId(): string {
    return `approval-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
