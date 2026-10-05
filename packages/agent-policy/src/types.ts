/**
 * Core types for the agent-policy package.
 *
 * These types define the policy delivery and enforcement model:
 * - PolicyManifest: describes the loaded rules (hashed, scoped, trusted)
 * - PolicyReceipt: proves a session received a specific revision
 * - HarnessRulesTool: the tool for retrieving and acknowledging rules
 * - MinimaxFindingEnvelope: LSP/code analysis verdict for tool results
 */

// ---------------------------------------------------------------------------
// Policy Manifest
// ---------------------------------------------------------------------------

/**
 * A single source file contributing to the policy.
 */
export interface PolicySource {
  /** Absolute path to the source file */
  path: string;
  /** Scope this source applies to (e.g., "src/", "packages/foo/") */
  scope: string;
  /** Whether this source is mandatory or advisory */
  priority: "mandatory" | "advisory";
  /** SHA-256 hash of the normalized content */
  sha256: string;
  /** Byte count of the content */
  bytes: number;
  /** Whether this is a harness-owned source (vs project-owned) */
  harnessOwned: boolean;
}

/**
 * Policy manifest describing all loaded rules for a session.
 */
export interface PolicyManifest {
  /** Short SHA-256 of the combined mandatory content */
  revision: string;
  /** Absolute path to the resolved project root */
  projectRoot: string;
  /** Trust level for project-owned rules */
  trust: "trusted" | "untrusted" | "unknown";
  /** Coverage status of the policy loading */
  coverage: "complete" | "partial" | "degraded";
  /** All sources contributing to this policy */
  sources: PolicySource[];
  /** When this manifest was created (ms since epoch) */
  loadedAt: number;
  /** Error message if coverage is degraded */
  loadError?: string;
}

// ---------------------------------------------------------------------------
// Policy Receipt
// ---------------------------------------------------------------------------

/**
 * Proof that a session received a specific policy revision.
 * Stored per-session to prevent reuse across sessions or scopes.
 */
export interface PolicyReceipt {
  /** Stable session identifier */
  sessionId: string;
  /** Project root this receipt applies to */
  projectRoot: string;
  /** The revision this receipt covers */
  revision: string;
  /** Scope this receipt applies to (empty = root scope) */
  scope: string;
  /** When the policy was delivered (ms since epoch) */
  deliveredAt: number;
  /** Which sections were delivered */
  sectionsDelivered: string[];
  /** Delivery method: 'system_prompt' or 'tool' */
  deliveryMethod: "system_prompt" | "tool";
}

/**
 * Check if a receipt covers a given manifest.
 */
export function receiptCoversManifest(receipt: PolicyReceipt, manifest: PolicyManifest): boolean {
  return (
    receipt.projectRoot === manifest.projectRoot &&
    receipt.revision === manifest.revision &&
    receipt.scope === getScopeFromManifest(manifest)
  );
}

/**
 * Extract scope from manifest sources.
 */
export function getScopeFromManifest(manifest: PolicyManifest): string {
  // Return the most specific (narrowest) scope from mandatory sources
  const mandatorySources = manifest.sources.filter(s => s.priority === "mandatory");
  if (mandatorySources.length === 0) return "";
  
  // Sort by scope length descending (most specific first)
  mandatorySources.sort((a, b) => b.scope.length - a.scope.length);
  return mandatorySources[0]?.scope ?? "";
}

// ---------------------------------------------------------------------------
// Tool Call Classification
// ---------------------------------------------------------------------------

/**
 * Classification of a tool call for policy enforcement.
 */
export interface ToolCallCapability {
  /** Whether this call can modify project files */
  mutatesProject: boolean;
  /** Whether this call can release the project (commit, push, build) */
  releasesProject: boolean;
  /** Specific file paths affected (if known) */
  affectedPaths?: string[];
  /** Whether this is a child agent delegation */
  isChildDelegation: boolean;
  /** Classification confidence */
  confidence: "high" | "medium" | "low";
}

/**
 * Classify a tool call by its name and input.
 */
export type ToolClassifier = (toolName: string, input: unknown) => ToolCallCapability;

/**
 * Default tool classifier for pi-harness.
 * Classifies actual capability, not just literal tool names.
 */
export function classifyToolCall(toolName: string, input: unknown): ToolCallCapability {
  const inputObj = input as Record<string, unknown> | undefined;
  
  switch (toolName) {
    case "write":
    case "edit":
    case "multi-edit":
      return {
        mutatesProject: true,
        releasesProject: false,
        affectedPaths: inputObj?.path ? [String(inputObj.path)] : undefined,
        isChildDelegation: false,
        confidence: "high",
      };
    
    case "bash":
    case "shell":
    case "ctx_execute":
    case "ctx_execute_file": {
      const command = String(inputObj?.command ?? "");
      const path = String(inputObj?.path ?? "");
      
      // Check for git operations
      if (/^git\s+(commit|push|checkout|reset|clean|merge|rebase)/.test(command)) {
        return {
          mutatesProject: true,
          releasesProject: true,
          affectedPaths: path ? [path] : undefined,
          isChildDelegation: false,
          confidence: "high",
        };
      }
      
      // Check for build/release commands
      if (/^(npm|bun|yarn|pnpm)\s+(run|build|test|publish|deploy)/.test(command) ||
          /^(cargo|go|make|gradle|mvn)\s+(build|test|run)/.test(command)) {
        return {
          mutatesProject: command.includes("--watch") || command.includes("-o "),
          releasesProject: true,
          affectedPaths: path ? [path] : undefined,
          isChildDelegation: false,
          confidence: "high",
        };
      }
      
      // General shell commands can modify files
      return {
        mutatesProject: true,
        releasesProject: false,
        affectedPaths: path ? [path] : undefined,
        isChildDelegation: false,
        confidence: "medium",
      };
    }
    
    case "subagent":
    case "spawn":
    case "delegate": {
      // Child agent delegation is a mutation-equivalent operation
      return {
        mutatesProject: true,
        releasesProject: false,
        affectedPaths: undefined,
        isChildDelegation: true,
        confidence: "high",
      };
    }
    
    case "read":
    case "glob":
    case "grep":
    case "search":
    case "symbol_search":
    case "find":
    case "lens_diagnostics":
    case "module_report":
    case "project_report":
      return {
        mutatesProject: false,
        releasesProject: false,
        affectedPaths: inputObj?.path ? [String(inputObj.path)] : undefined,
        isChildDelegation: false,
        confidence: "high",
      };
    
    case "harness_rules":
      return {
        mutatesProject: false,
        releasesProject: false,
        affectedPaths: undefined,
        isChildDelegation: false,
        confidence: "high",
      };
    
    default:
      // Unknown tools: conservative assumption
      return {
        mutatesProject: true,
        releasesProject: false,
        affectedPaths: undefined,
        isChildDelegation: false,
        confidence: "low",
      };
  }
}

// ---------------------------------------------------------------------------
// Harness Rules Tool
// ---------------------------------------------------------------------------

/**
 * Input for the harness_rules tool.
 */
export type HarnessRulesInput =
  | { action: "manifest" }
  | { action: "read"; source?: string; section?: string }
  | { action: "acknowledge"; revision: string };

/**
 * Output for the harness_rules tool.
 */
export interface HarnessRulesOutput {
  manifest?: PolicyManifest;
  sections?: PolicySection[];
  receipt?: PolicyReceipt;
  acknowledged?: boolean;
  error?: string;
}

/**
 * A single section of a policy source.
 */
export interface PolicySection {
  /** Section identifier (heading or index) */
  id: string;
  /** Section title */
  title: string;
  /** Section content */
  content: string;
  /** Source file path */
  source: string;
  /** Scope this section applies to */
  scope: string;
  /** Priority of the containing source */
  priority: "mandatory" | "advisory";
  /** Byte offset in source */
  offset: number;
  /** Whether this section was truncated */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Minimax Finding Envelope
// ---------------------------------------------------------------------------

/**
 * A single code finding from LSP or other analyzer.
 */
export interface PolicyFinding {
  /** Unique identifier for this finding */
  id: string;
  /** File path (relative or absolute) */
  path: string;
  /** Line number (1-based) */
  line?: number;
  /** Column number (1-based) */
  column?: number;
  /** Source of this finding */
  source: "lsp" | "runner" | "structural" | "test" | "security" | "policy";
  /** Human-readable message */
  message: string;
  /** Suggested fix (if available) */
  fix?: string;
  /** Severity level */
  severity: "error" | "warning" | "information" | "hint";
  /** Whether this finding blocks completion */
  blocking: boolean;
}

/**
 * Envelope for code analysis findings, attached to tool results.
 * This is the pi-lens-style verdict that Minimax respects.
 */
export interface MinimaxFindingEnvelope {
  /** Overall verdict */
  verdict: "blocking" | "advisory" | "clean" | "degraded";
  /** Coverage level of this analysis */
  coverage: "delta" | "targeted" | "full";
  /** Freshness of the analysis */
  freshness: "fresh" | "stale" | "indeterminate";
  /** Individual findings */
  findings: PolicyFinding[];
  /** Suggested next action */
  nextAction?: "fix" | "reread" | "run_full" | "continue";
  /** Human-readable summary for display */
  summary: string;
}

/**
 * Combined verdict for harness policy + code analysis.
 */
export interface HarnessAgentVerdict {
  /** Policy status */
  policy: {
    revision: string;
    received: boolean;
    coverage: "complete" | "partial" | "degraded";
  };
  /** Code analysis status */
  code: MinimaxFindingEnvelope;
  /** Whether completion is allowed */
  completionAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Extension Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the agent-policy extension.
 */
export interface AgentPolicyConfig {
  /** Path to the harness-owned AGENTS.md */
  harnessRulesPath: URL;
  /** Whether to require receipt before mutation */
  requireReceiptBeforeMutation: boolean;
  /** LSP mode: 'pi-lens' (compose) or 'native' (fallback) */
  lspMode: "pi-lens" | "native";
  /** Optional: path to additional harness rules */
  additionalRulesPaths?: URL[];
  /** Optional: custom tool classifier */
  toolClassifier?: ToolClassifier;
  /** Whether to enable Git guard (blocks commit until blockers cleared) */
  gitGuardEnabled?: boolean;
  /** Whether to enable build guard */
  buildGuardEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

/**
 * Events emitted by the policy runtime.
 */
export interface PolicyEvents {
  /** Fired when a policy is loaded */
  onPolicyLoaded?: (manifest: PolicyManifest) => void;
  /** Fired when a policy receipt is recorded */
  onReceiptRecorded?: (receipt: PolicyReceipt) => void;
  /** Fired when a mutation is blocked */
  onMutationBlocked?: (event: { sessionId: string; revision: string; reason: string }) => void;
  /** Fired when policy coverage is degraded */
  onCoverageDegraded?: (event: { reason: string; error?: string }) => void;
}
