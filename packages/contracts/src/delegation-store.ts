/**
 * Delegation Store
 * 
 * Durable storage for delegation receipts.
 * Stores in ignored harness state directory.
 */

import { homedir as osHomedir } from "node:os";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { join } from "path";
import type { DelegationReceipt } from "./delegation.js";

/**
 * Store directory path
 */
const STORE_DIR = join(process.env.HOME || osHomedir(), ".pi-harness-runtime", "delegation-state");

/**
 * Ensure store directory exists
 */
function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

/**
 * Get receipt file path for workspace + task
 */
function getReceiptPath(workspacePath: string, taskId: string): string {
  // Sanitize path for use as filename
  const safePath = workspacePath.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-100);
  const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(STORE_DIR, `${safePath}__${safeTask}.json`);
}

/**
 * Save delegation receipt
 */
export function saveDelegationReceipt(receipt: DelegationReceipt): void {
  ensureStoreDir();
  const path = getReceiptPath(receipt.workspacePath, receipt.parentTaskId);
  
  // Atomic write: write to temp, then rename
  const tempPath = path + ".tmp";
  writeFileSync(tempPath, JSON.stringify(receipt, null, 2), "utf8");
  
  // Rename is atomic on POSIX
  try {
    renameSync(tempPath, path);
  } catch {
    // Fallback: just move the file
    try {
      writeFileSync(path, JSON.stringify(receipt, null, 2), "utf8");
    } catch {
      // Ignore write errors
    }
  }
}

/**
 * Load delegation receipt
 */
export function loadDelegationReceipt(
  workspacePath: string,
  taskId: string
): DelegationReceipt | null {
  const path = getReceiptPath(workspacePath, taskId);
  
  if (!existsSync(path)) {
    return null;
  }
  
  try {
    const content = readFileSync(path, "utf8");
    const receipt = JSON.parse(content) as DelegationReceipt;
    
    // Validate version
    if (receipt.version !== 1) {
      // Future migration logic would go here
      return null;
    }
    
    return receipt;
  } catch {
    return null;
  }
}

/**
 * Delete delegation receipt
 */
export function deleteDelegationReceipt(
  workspacePath: string,
  taskId: string
): void {
  const path = getReceiptPath(workspacePath, taskId);
  
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Ignore delete errors
    }
  }
}

/**
 * List all receipts for a workspace
 */
export function listDelegationReceipts(workspacePath: string): DelegationReceipt[] {
  ensureStoreDir();
  const receipts: DelegationReceipt[] = [];
  
  try {
    const files = readdirSync(STORE_DIR);
    
    const safePathPrefix = workspacePath.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-100) + "__";
    
    for (const file of files) {
      if (!file.startsWith(safePathPrefix) || !file.endsWith(".json")) {
        continue;
      }
      
      try {
        const content = readFileSync(join(STORE_DIR, file), "utf8");
        const receipt = JSON.parse(content) as DelegationReceipt;
        if (receipt.workspacePath === workspacePath) {
          receipts.push(receipt);
        }
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  
  return receipts;
}

/**
 * Update receipt status
 */
export function updateReceiptStatus(
  workspacePath: string,
  taskId: string,
  status: DelegationReceipt["status"],
  updates?: Partial<DelegationReceipt>
): DelegationReceipt | null {
  const receipt = loadDelegationReceipt(workspacePath, taskId);
  
  if (!receipt) {
    return null;
  }
  
  const updated: DelegationReceipt = {
    ...receipt,
    ...updates,
    status,
    updatedAt: Date.now(),
  };
  
  saveDelegationReceipt(updated);
  return updated;
}

/**
 * Check if receipt exists for task
 */
export function hasReceipt(workspacePath: string, taskId: string): boolean {
  const path = getReceiptPath(workspacePath, taskId);
  return existsSync(path);
}

/**
 * Compact receipt for storage after compaction
 */
export function compactReceipt(receipt: DelegationReceipt): DelegationReceipt {
  return {
    version: receipt.version,
    workspacePath: receipt.workspacePath,
    sessionId: receipt.sessionId,
    parentTaskId: receipt.parentTaskId,
    scopeFingerprint: receipt.scopeFingerprint,
    decision: {
      strategy: receipt.decision.strategy,
      reason: receipt.decision.reason,
      workGroups: receipt.decision.workGroups.filter((g) => g.status === "pending" || g.status === "dispatched" || g.status === "running"),
      validationExpectations: receipt.decision.validationExpectations,
      confidence: receipt.decision.confidence,
      jevUsed: receipt.decision.jevUsed,
      reassessmentTriggers: receipt.decision.reassessmentTriggers,
    },
    createdAt: receipt.createdAt,
    updatedAt: Date.now(),
    status: receipt.status,
    childIds: receipt.childIds,
    pendingValidation: receipt.pendingValidation,
    userConstraints: receipt.userConstraints,
  };
}
