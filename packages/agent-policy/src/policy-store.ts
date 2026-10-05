/**
 * PolicyStore - Session receipt tracking and validation.
 *
 * Responsibilities:
 * - Record when a policy revision was delivered to a session
 * - Validate receipts against current manifest
 * - Invalidate receipts when rules change
 * - Track delivery method (system_prompt vs tool)
 */

import type { PolicyManifest, PolicyReceipt } from "./types.js";

// ---------------------------------------------------------------------------
// PolicyStore
// ---------------------------------------------------------------------------

/**
 * Policy store configuration.
 */
export interface PolicyStoreConfig {
  /** Maximum receipts to keep per session (prevents memory leaks) */
  maxReceiptsPerSession?: number;
  /** Receipt TTL in milliseconds (default: 24 hours) */
  receiptTtlMs?: number;
}

/**
 * Stores policy receipts and validates delivery.
 */
export class PolicyStore {
  private receipts: Map<string, PolicyReceipt> = new Map();
  private sessionScopes: Map<string, Set<string>> = new Map();
  private lastKnownManifests: Map<string, PolicyManifest> = new Map();
  private config: Required<PolicyStoreConfig>;

  constructor(config: PolicyStoreConfig = {}) {
    this.config = {
      maxReceiptsPerSession: config.maxReceiptsPerSession ?? 100,
      receiptTtlMs: config.receiptTtlMs ?? 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  /**
   * Record a policy delivery for a session.
   */
  noteDelivered(
    sessionId: string,
    manifest: PolicyManifest,
    deliveryMethod: "system_prompt" | "tool" = "system_prompt",
    sectionsDelivered: string[] = ["*"]
  ): PolicyReceipt {
    // Invalidate any existing receipt for this session+scope
    const existingKey = this.getReceiptKey(sessionId, manifest.projectRoot, "");
    this.receipts.delete(existingKey);

    const receipt: PolicyReceipt = {
      sessionId,
      projectRoot: manifest.projectRoot,
      revision: manifest.revision,
      scope: this.getScopeFromManifest(manifest),
      deliveredAt: Date.now(),
      sectionsDelivered,
      deliveryMethod,
    };

    this.receipts.set(existingKey, receipt);

    // Track scope for this session
    if (!this.sessionScopes.has(sessionId)) {
      this.sessionScopes.set(sessionId, new Set());
    }
    this.sessionScopes.get(sessionId)!.add(manifest.projectRoot);

    // Store manifest for later validation
    this.lastKnownManifests.set(existingKey, manifest);

    // Cleanup old receipts if needed
    this.cleanupOldReceipts();

    return receipt;
  }

  /**
   * Get receipt for a session, if it exists.
   */
  getReceipt(sessionId: string, projectRoot?: string, scope?: string): PolicyReceipt | null {
    const key = this.getReceiptKey(sessionId, projectRoot ?? "", scope ?? "");
    const receipt = this.receipts.get(key);

    if (!receipt) return null;

    // Check TTL
    if (Date.now() - receipt.deliveredAt > this.config.receiptTtlMs) {
      this.receipts.delete(key);
      return null;
    }

    return receipt;
  }

  /**
   * Check if a session has a valid receipt for the given manifest.
   */
  hasValidReceipt(sessionId: string, manifest: PolicyManifest): boolean {
    const receipt = this.getReceipt(sessionId, manifest.projectRoot);
    if (!receipt) return false;

    // Check revision match
    if (receipt.revision !== manifest.revision) {
      return false;
    }

    // Check scope coverage
    const receiptScope = receipt.scope;
    const manifestScope = this.getScopeFromManifest(manifest);
    
    if (receiptScope && manifestScope && !receiptScope.startsWith(manifestScope)) {
      return false;
    }

    return true;
  }

  /**
   * Validate a receipt against the current manifest.
   */
  validateReceipt(sessionId: string, manifest: PolicyManifest): {
    valid: boolean;
    reason?: string;
  } {
    const receipt = this.getReceipt(sessionId, manifest.projectRoot);

    if (!receipt) {
      return { valid: false, reason: "No receipt found for this session" };
    }

    if (receipt.revision !== manifest.revision) {
      return {
        valid: false,
        reason: `Receipt revision ${receipt.revision} does not match current ${manifest.revision}`,
      };
    }

    if (Date.now() - receipt.deliveredAt > this.config.receiptTtlMs) {
      return { valid: false, reason: "Receipt has expired" };
    }

    return { valid: true };
  }

  /**
   * Invalidate receipts when a rule file changes.
   */
  invalidateOnChange(changedPath: string): string[] {
    const invalidatedSessions: string[] = [];

    for (const [key, manifest] of this.lastKnownManifests) {
      // Check if the changed path affects any of our sources
      const affectedSource = manifest.sources.find(s => 
        s.path === changedPath || s.path.includes(changedPath)
      );

      if (affectedSource) {
        // Extract session ID from key
        const sessionId = key.split("|")[0];
        this.receipts.delete(key);
        invalidatedSessions.push(sessionId);
      }
    }

    return invalidatedSessions;
  }

  /**
   * Invalidate all receipts for a project root.
   */
  invalidateProject(projectRoot: string): void {
    for (const [key, receipt] of this.receipts) {
      if (receipt.projectRoot === projectRoot) {
        this.receipts.delete(key);
      }
    }

    // Also clean up last known manifests for this project
    for (const [key, manifest] of this.lastKnownManifests) {
      if (manifest.projectRoot === projectRoot) {
        this.lastKnownManifests.delete(key);
      }
    }
  }

  /**
   * Invalidate all receipts (e.g., after compaction).
   */
  invalidateAll(): void {
    this.receipts.clear();
    this.sessionScopes.clear();
  }

  /**
   * Clear receipts for a specific session.
   */
  clearSession(sessionId: string): void {
    for (const [key, receipt] of this.receipts) {
      if (receipt.sessionId === sessionId) {
        this.receipts.delete(key);
      }
    }
    this.sessionScopes.delete(sessionId);
  }

  /**
   * Get all receipts for a session.
   */
  getSessionReceipts(sessionId: string): PolicyReceipt[] {
    const receipts: PolicyReceipt[] = [];
    for (const receipt of this.receipts.values()) {
      if (receipt.sessionId === sessionId) {
        receipts.push(receipt);
      }
    }
    return receipts;
  }

  /**
   * Get statistics about stored receipts.
   */
  getStats(): {
    totalReceipts: number;
    sessionsTracked: number;
    projectsTracked: number;
    oldestReceipt: number | null;
    newestReceipt: number | null;
  } {
    let oldest: number | null = null;
    let newest: number | null = null;
    const projects = new Set<string>();

    for (const receipt of this.receipts.values()) {
      if (oldest === null || receipt.deliveredAt < oldest) {
        oldest = receipt.deliveredAt;
      }
      if (newest === null || receipt.deliveredAt > newest) {
        newest = receipt.deliveredAt;
      }
      projects.add(receipt.projectRoot);
    }

    return {
      totalReceipts: this.receipts.size,
      sessionsTracked: this.sessionScopes.size,
      projectsTracked: projects.size,
      oldestReceipt: oldest,
      newestReceipt: newest,
    };
  }

  /**
   * Generate receipt key for storage.
   */
  private getReceiptKey(sessionId: string, projectRoot: string, scope: string): string {
    return `${sessionId}|${projectRoot}|${scope}`;
  }

  /**
   * Extract scope from manifest.
   */
  private getScopeFromManifest(manifest: PolicyManifest): string {
    const mandatorySources = manifest.sources.filter(s => s.priority === "mandatory");
    if (mandatorySources.length === 0) return "";
    
    // Get the most specific (longest) scope
    mandatorySources.sort((a, b) => b.scope.length - a.scope.length);
    return mandatorySources[0]?.scope ?? "";
  }

  /**
   * Cleanup old receipts to prevent memory leaks.
   */
  private cleanupOldReceipts(): void {
    if (this.receipts.size <= this.config.maxReceiptsPerSession) {
      return;
    }

    // Sort by delivery time, oldest first
    const sorted = [...this.receipts.entries()].sort(
      (a, b) => a[1].deliveredAt - b[1].deliveredAt
    );

    // Remove oldest entries until under limit
    const toRemove = sorted.slice(0, sorted.length - this.config.maxReceiptsPerSession);
    for (const [key] of toRemove) {
      this.receipts.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (for use in extension)
// ---------------------------------------------------------------------------

let globalPolicyStore: PolicyStore | null = null;

/**
 * Get the global policy store instance.
 */
export function getPolicyStore(): PolicyStore {
  if (!globalPolicyStore) {
    globalPolicyStore = new PolicyStore();
  }
  return globalPolicyStore;
}

/**
 * Reset the global policy store (for testing).
 */
export function resetPolicyStore(): void {
  globalPolicyStore = null;
}
