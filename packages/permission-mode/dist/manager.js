/**
 * Approval Manager
 *
 * Manages the approval workflow for pending actions.
 */
/**
 * Approval Manager
 */
export class ApprovalManager {
    pending = new Map();
    options;
    constructor(options = {}) {
        this.options = {
            defaultTimeout: options.defaultTimeout ?? 300,
            onApprovalRequest: options.onApprovalRequest ?? (() => { }),
            onApprovalGranted: options.onApprovalGranted ?? (() => { }),
            onApprovalRejected: options.onApprovalRejected ?? (() => { }),
            onApprovalExpired: options.onApprovalExpired ?? (() => { }),
        };
    }
    requestApproval(request) {
        const id = this.generateId();
        const createdAt = new Date();
        const timeoutSeconds = request.expiresIn ?? this.options.defaultTimeout;
        const expiresAt = new Date(createdAt.getTime() + timeoutSeconds * 1000);
        const approval = { id, request, status: 'pending', createdAt, expiresAt };
        this.pending.set(id, approval);
        this.options.onApprovalRequest(approval);
        if (timeoutSeconds > 0) {
            // SAFETY: globalThis always has setTimeout in JS runtimes (browsers, Node.js)
            const global = globalThis;
            global.setTimeout(() => this.checkExpiration(id), timeoutSeconds * 1000);
        }
        return approval;
    }
    respond(response) {
        const approval = this.pending.get(response.id);
        if (!approval)
            return null;
        approval.status = response.approved ? 'approved' : 'rejected';
        approval.respondedAt = new Date();
        if (response.approved) {
            this.options.onApprovalGranted(approval);
        }
        else {
            this.options.onApprovalRejected(approval);
        }
        // Remove from pending after a short delay
        // SAFETY: globalThis always has setTimeout in JS runtimes
        const global = globalThis;
        global.setTimeout(() => this.pending.delete(response.id), 1000);
        return approval;
    }
    getPending() {
        return Array.from(this.pending.values()).filter(a => a.status === 'pending');
    }
    get(id) {
        return this.pending.get(id);
    }
    hasPending() {
        return this.getPending().length > 0;
    }
    countPending() {
        return this.getPending().length;
    }
    cancel(id) {
        const approval = this.pending.get(id);
        if (approval && approval.status === 'pending') {
            approval.status = 'rejected';
            approval.respondedAt = new Date();
            this.options.onApprovalRejected(approval);
            return true;
        }
        return false;
    }
    checkExpiration(id) {
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
    generateId() {
        return `approval-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
}
