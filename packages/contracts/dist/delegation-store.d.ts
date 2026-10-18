/**
 * Delegation Store
 *
 * Durable storage for delegation receipts.
 * Stores in ignored harness state directory.
 */
import type { DelegationReceipt } from "./delegation.js";
/**
 * Save delegation receipt
 */
export declare function saveDelegationReceipt(receipt: DelegationReceipt): void;
/**
 * Load delegation receipt
 */
export declare function loadDelegationReceipt(workspacePath: string, taskId: string): DelegationReceipt | null;
/**
 * Delete delegation receipt
 */
export declare function deleteDelegationReceipt(workspacePath: string, taskId: string): void;
/**
 * List all receipts for a workspace
 */
export declare function listDelegationReceipts(workspacePath: string): DelegationReceipt[];
/**
 * Update receipt status
 */
export declare function updateReceiptStatus(workspacePath: string, taskId: string, status: DelegationReceipt["status"], updates?: Partial<DelegationReceipt>): DelegationReceipt | null;
/**
 * Check if receipt exists for task
 */
export declare function hasReceipt(workspacePath: string, taskId: string): boolean;
/**
 * Compact receipt for storage after compaction
 */
export declare function compactReceipt(receipt: DelegationReceipt): DelegationReceipt;
