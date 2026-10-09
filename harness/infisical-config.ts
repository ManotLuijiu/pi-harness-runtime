/**
 * Infisical Configuration Module
 *
 * Manages validated non-secret configuration for Infisical/Varlock integration.
 * Stores metadata at ~/.pi-harness-runtime/infisical/config.json
 *
 * Does NOT store secrets, tokens, or resolved values.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Infisical site URLs
 */
export type InfisicalSite = "us" | "eu" | "custom";

/**
 * Infisical authentication method
 */
export type InfisicalAuthMethod = "universal" | "oidc";

/**
 * Service that can use Infisical secrets
 */
export type ServiceName =
  | "infisical"     // Infisical provider itself (for logging)
  | "jev"           // TypeSafe Jev
  | "honcho"        // Honcho memory
  | "qdrant"        // Qdrant vector search
  | "telegram"       // Telegram bot
  | "embeddings"     // OpenAI/embedding provider
  | "planner"       // LangChain planner
  | "minimax"       // Minimax provider
  | "glm";          // GLM provider

/**
 * Secret name mapping for a service
 */
export interface ServiceSecretMapping {
  service: ServiceName;
  required: boolean;
  keys: Record<string, string>; // local key -> Infisical secret name
}

/**
 * Bootstrap reference type
 */
export type BootstrapRef =
  | { type: "env"; name: string }           // env:VAR_NAME
  | { type: "file"; path: string };         // file:/absolute/path

/**
 * Infisical configuration (non-secret metadata only)
 */
export interface InfisicalConfig {
  /** Schema version for future migrations */
  schemaVersion: 1;

  /** Whether Infisical integration is enabled */
  enabled: boolean;

  /** Active revision ID */
  activeRevision: string | null;

  /** Infisical site */
  site: InfisicalSite;
  customSiteUrl?: string;  // Only if site === "custom"

  /** Project and environment */
  projectId: string;
  environment: string;      // e.g., "production", "development"
  secretPath: string;       // e.g., "/harness"

  /** Authentication method */
  authMethod: InfisicalAuthMethod;

  /** Bootstrap reference (not actual credentials) */
  bootstrapRef: BootstrapRef;

  /** Enabled services and their secret mappings */
  services: ServiceSecretMapping[];

  /** Source policy */
  sourcePolicy: {
    /** Use remote as authoritative for selected services */
    remoteAuthoritative: boolean;
    /** Allow environment variable overrides */
    envOverride: boolean;
  };

  /** Last resolution timestamp */
  lastResolvedAt: string | null;

  /** Last error if any */
  lastError: string | null;
}

/**
 * Schema revision directory metadata
 */
export interface SchemaRevision {
  revisionId: string;
  createdAt: string;
  environment: string;
  secretPath: string;
  services: ServiceName[];
  validated: boolean;
}

/**
 * Get Infisical config directory
 */
export function getInfisicalDir(): string {
  return join(homedir(), ".pi-harness-runtime", "infisical");
}

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return join(getInfisicalDir(), "config.json");
}

/**
 * Get revisions directory
 */
export function getRevisionsDir(): string {
  return join(getInfisicalDir(), "revisions");
}

/**
 * Ensure directories exist with proper permissions
 */
export function ensureDirectories(): void {
  const baseDir = getInfisicalDir();
  const revDir = getRevisionsDir();

  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  }

  if (!existsSync(revDir)) {
    mkdirSync(revDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load existing configuration
 */
export function loadConfig(): InfisicalConfig | null {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf8");
    const config = JSON.parse(content) as InfisicalConfig;

    // Validate schema version
    if (config.schemaVersion !== 1) {
      console.warn("[infisical-config] Unknown schema version:", config.schemaVersion);
      return null;
    }

    return config;
  } catch (err) {
    console.error("[infisical-config] Failed to load config:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Save configuration atomically
 */
export function saveConfig(config: InfisicalConfig): void {
  ensureDirectories();

  const configPath = getConfigPath();
  const tempPath = `${configPath}.tmp`;

  try {
    // Write to temp file with restricted permissions
    writeFileSync(tempPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    chmodSync(tempPath, 0o600);

    // Atomic rename
    writeFileSync(configPath, readFileSync(tempPath));
    unlinkSync(tempPath);
  } catch (err) {
    // Clean up temp file if it exists
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* ignore */ }
    }
    throw err;
  }
}

/**
 * Create a new revision directory
 */
export function createRevision(config: InfisicalConfig): string {
  ensureDirectories();

  const revId = `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const revDir = join(getRevisionsDir(), revId);

  mkdirSync(revDir, { mode: 0o700 });

  // Save revision metadata
  const revision: SchemaRevision = {
    revisionId: revId,
    createdAt: new Date().toISOString(),
    environment: config.environment,
    secretPath: config.secretPath,
    services: config.services.map(s => s.service),
    validated: false,
  };

  writeFileSync(
    join(revDir, "revision.json"),
    JSON.stringify(revision, null, 2),
    { mode: 0o600 }
  );

  return revId;
}

/**
 * Get revision metadata
 */
export function getRevision(revisionId: string): SchemaRevision | null {
  const revPath = join(getRevisionsDir(), revisionId, "revision.json");

  if (!existsSync(revPath)) {
    return null;
  }

  try {
    const content = readFileSync(revPath, "utf8");
    return JSON.parse(content) as SchemaRevision;
  } catch {
    return null;
  }
}

/**
 * Get schema file path for a revision
 */
export function getSchemaPath(revisionId: string): string {
  return join(getRevisionsDir(), revisionId, ".env.schema");
}

/**
 * Mark revision as validated
 */
export function markRevisionValidated(revisionId: string): void {
  const revDir = join(getRevisionsDir(), revisionId);
  const revPath = join(revDir, "revision.json");

  if (!existsSync(revPath)) {
    throw new Error(`Revision not found: ${revisionId}`);
  }

  let revision: SchemaRevision;
  try {
    revision = JSON.parse(readFileSync(revPath, "utf8")) as SchemaRevision;
  } catch {
    throw new Error(`Failed to parse revision: ${revisionId}`);
  }

  revision.validated = true;
  writeFileSync(revPath, JSON.stringify(revision, null, 2), { mode: 0o600 });
}

/**
 * Activate a revision
 */
export function activateRevision(revisionId: string): void {
  const config = loadConfig();
  if (!config) {
    throw new Error("No config loaded");
  }

  const revision = getRevision(revisionId);
  if (!revision) {
    throw new Error(`Revision not found: ${revisionId}`);
  }

  if (!revision.validated) {
    throw new Error(`Revision not validated: ${revisionId}`);
  }

  // Update config with new active revision
  const updatedConfig: InfisicalConfig = {
    ...config,
    activeRevision: revisionId,
    lastResolvedAt: new Date().toISOString(),
    lastError: null,
  };

  saveConfig(updatedConfig);
}

/**
 * Get the site URL from config
 */
export function getSiteUrl(config: InfisicalConfig): string {
  switch (config.site) {
    case "us":
      return "https://app.infisical.com";
    case "eu":
      return "https://eu.infisical.com";
    case "custom":
      if (!config.customSiteUrl) {
        throw new Error("Custom site URL not set");
      }
      return config.customSiteUrl;
  }
}

/**
 * Validate site URL
 */
export function isValidSiteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/**
 * Clean up old revisions (keep last N)
 */
export function cleanupOldRevisions(keepCount: number = 5): void {
  const revDir = getRevisionsDir();
  if (!existsSync(revDir)) return;

  const config = loadConfig();
  const activeRev = config?.activeRevision;

  // List all revision directories
  const revisions = existsSync(revDir)
    ? readdirSync(revDir).filter(f => f.startsWith("rev_"))
    : [];

  // Sort by creation time (oldest first)
  revisions.sort((a, b) => {
    const metaA = getRevision(a);
    const metaB = getRevision(b);
    return (metaA?.createdAt ?? "").localeCompare(metaB?.createdAt ?? "");
  });

  // Delete old revisions (but never delete active)
  const toDelete = revisions.slice(0, Math.max(0, revisions.length - keepCount));

  for (const rev of toDelete) {
    if (rev === activeRev) continue;

    const revPath = join(revDir, rev);
    try {
      rmSync(revPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Disable Infisical integration
 */
export function disableIntegration(): void {
  const config = loadConfig();
  if (!config) return;

  const updatedConfig: InfisicalConfig = {
    ...config,
    enabled: false,
  };

  saveConfig(updatedConfig);
}

/**
 * Check if Infisical is configured and enabled
 */
export function isConfigured(): boolean {
  const config = loadConfig();
  return config !== null && config.enabled;
}
