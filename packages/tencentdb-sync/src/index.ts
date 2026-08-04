/**
 * TencentDB Sync (RFC-0105/0106)
 *
 * Syncs SKILL.md files to TencentDB-Agent-Memory server.
 */

export { createTencentDBClient, TencentDBClient } from "./client.js";
export type {
  Skill,
  SkillSearchResult,
  Knowledge,
  HealthStatus,
} from "./client.js";

export { loadConfig, validateConfig, type SyncConfig } from "./config.js";
