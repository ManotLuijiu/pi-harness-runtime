/**
 * pi-harness-runtime Skills System Types
 * 
 * Based on:
 * - pi.dev Agent Skills specification (https://pi.dev/docs/latest/skills)
 * - Hermes Agent skill system
 */

// === pi.dev Standard Fields (Agent Skills Spec) ===

export interface SkillFrontmatter {
  /** Command and display name (kebab-case, max 64 chars) */
  name: string;
  /** Routing description shown to the model (max 1024 chars) */
  description: string;
  /** Skill version in semver format */
  version?: string;
  /** License name or bundled license file */
  license?: string;
  /** Environment requirements (e.g., "unix", "windows") */
  compatibility?: string;
  /** Additional key-value metadata */
  metadata?: Record<string, unknown>;
  /** Experimental pre-approved tool list */
  allowed_tools?: string[];
  /** Hide from automatic model selection */
  disable_model_invocation?: boolean;
}

// === Hermes Extensions ===

export interface HermesExtensions {
  /** Who created: "agent" | "user" | "curator" */
  author?: "agent" | "user" | "curator";
  /** Confidence score (0.0 - 1.0) */
  confidence?: number;
  /** Number of times skill was used */
  usage_count?: number;
  /** ISO timestamp when created */
  created_at?: string;
  /** ISO timestamp when last updated */
  updated_at?: string;
  /** Patterns that trigger skill loading */
  triggers?: string[];
  /** Known pitfalls with explanations */
  pitfalls?: SkillPitfall[];
  /** Patterns to avoid */
  anti_patterns?: string[];
  /** Allow curator to auto-patch */
  auto_update?: boolean;
}

export interface SkillPitfall {
  name: string;
  why: string;
  affects?: string;
}

// === Complete Skill ===

export interface SkillMetadata extends Partial<SkillFrontmatter>, Partial<HermesExtensions> {}

export interface Skill {
  /** Unique identifier (derived from directory name) */
  id: string;
  /** Full path to skill directory */
  path: string;
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;
  /** Hermes extensions (merged into metadata) */
  hermes?: HermesExtensions;
  /** Raw body content after frontmatter */
  body: string;
  /** Supported reference files */
  references: SkillReference[];
  /** Example files */
  examples: SkillExample[];
  /** Full metadata (merged frontmatter + hermes) */
  metadata: SkillMetadata;
  /** Loading state */
  loaded: boolean;
  /** Last used timestamp */
  lastUsed?: number;
  /** Lint results (if linted) */
  lintResults?: LintResult[];
}

export interface SkillReference {
  name: string;
  path: string;
  relativePath: string;
}

export interface SkillExample {
  name: string;
  path: string;
  relativePath: string;
}

// === Skill Index (Lightweight) ===

export interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  version?: string;
  triggers?: string[];
  loaded: boolean;
}

export interface SkillIndex {
  entries: SkillIndexEntry[];
  loadedAt: number;
}

// === Linter Types ===

export type LintSeverity = "error" | "warning" | "info";

export interface LintResult {
  rule: string;
  severity: LintSeverity;
  message: string;
  line?: number;
}

export interface LintRule {
  name: string;
  description: string;
  severity: LintSeverity;
  check: (skill: Skill) => LintResult | null;
}

// === Scanner Types ===

export interface ScanOptions {
  /** Directories to scan */
  directories: string[];
  /** Recursive scan depth (0 = unlimited) */
  maxDepth?: number;
  /** Include hidden directories */
  includeHidden?: boolean;
  /** File patterns to include */
  includePatterns?: string[];
  /** File patterns to exclude */
  excludePatterns?: string[];
}

export interface ScanResult {
  skills: Skill[];
  errors: ScanError[];
  scannedPaths: string[];
  durationMs: number;
}

export interface ScanError {
  path: string;
  error: string;
}

// === Registry Types ===

export interface MatchOptions {
  /** Match threshold (0.0 - 1.0) */
  threshold?: number;
  /** Include disabled skills */
  includeDisabled?: boolean;
  /** Sort by score or usage */
  sortBy?: "score" | "usage" | "name";
}

export interface MatchResult {
  skill: Skill;
  score: number;
  matchedTriggers: string[];
}

// === Loader Types ===

export interface LoadOptions {
  /** Load references content */
  loadReferences?: boolean;
  /** Load examples content */
  loadExamples?: boolean;
  /** Parse body markdown */
  parseMarkdown?: boolean;
}

export interface LoadedSkill extends Skill {
  /** Loaded reference content */
  referencesContent?: Map<string, string>;
  /** Loaded examples content */
  examplesContent?: Map<string, string>;
  /** Parsed markdown */
  parsedBody?: ParsedMarkdown;
}

export interface ParsedMarkdown {
  html?: string;
  sections?: MarkdownSection[];
}

export interface MarkdownSection {
  level: number;
  title: string;
  content: string;
}

// === Write Approval Types ===

export type PendingWriteAction = 
  | { action: "create"; skill: Partial<Skill> }
  | { action: "patch"; skillId: string; diff: SkillDiff }
  | { action: "delete"; skillId: string }
  | { action: "write_file"; skillId: string; file: string; content: string }
  | { action: "remove_file"; skillId: string; file: string };

export interface PendingWrite {
  id: string;
  action: PendingWriteAction;
  timestamp: number;
  author: "agent" | "user" | "curator";
  status: "pending" | "approved" | "rejected";
  metadata?: Record<string, unknown>;
}

export interface SkillDiff {
  frontmatter?: Partial<SkillFrontmatter>;
  body?: { old: string; new: string };
  references?: { added?: string[]; removed?: string[] };
  examples?: { added?: string[]; removed?: string[] };
}

// === Configuration Types ===

export interface SkillsConfig {
  enabled: boolean;
  locations: string[];
  write_approval: boolean;
  auto_create_threshold: number;
  auto_patch_threshold: number;
  progressive_disclosure: boolean;
  default_author: "agent" | "user" | "curator";
}

export const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  enabled: true,
  locations: [
    "~/.pi-harness/skills",
    "skills",
    ".agents/skills"
  ],
  write_approval: false,
  auto_create_threshold: 3,
  auto_patch_threshold: 1,
  progressive_disclosure: true,
  default_author: "agent"
};
