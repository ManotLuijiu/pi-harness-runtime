/**
 * Secret Schema Module
 *
 * Generates Varlock schema files and manages secret name mappings.
 */

import type { InfisicalConfig, ServiceSecretMapping, ServiceName } from "./infisical-config.js";

export type { ServiceName, ServiceSecretMapping } from "./infisical-config.js";

/**
 * Standard secret keys for each service
 */
export const SERVICE_SECRET_KEYS: Record<ServiceName, string[]> = {
  infisical: [],  // No secrets for the Infisical provider itself
  jev: ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"],
  honcho: ["HONCHO_API_KEY"],
  qdrant: ["QDRANT_CLUSTER_ENDPOINT", "QDRANT_API_KEY", "QDRANT_COLLECTION"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET"],
  embeddings: ["OPENAI_API_KEY"],
  planner: ["PLANNER_API_KEY", "PLANNER_BASE_URL", "PLANNER_MODEL"],
  minimax: ["MINIMAX_API_KEY", "MINIMAX_BASE_URL", "MINIMAX_MODEL"],
  glm: ["GLM_API_KEY", "GLM_BASE_URL", "GLM_MODEL"],
};

/**
 * Generate Varlock schema for Infisical config
 */
export function generateSchema(config: InfisicalConfig): string {
  const lines: string[] = [
    "# @plugin(@varlock/infisical-plugin)",
    `# @initInfisical(projectId=${config.projectId}, environment=${config.environment}, siteUrl=${getSiteUrl(config)}, secretPath=${config.secretPath}, clientId=$INFISICAL_CLIENT_ID, clientSecret=$INFISICAL_CLIENT_SECRET, cacheTtl=false)`,
    "# ---",
    "",
  ];

  // Internal bootstrap variables (not resolved secrets)
  lines.push("# @type=string @internal");
  lines.push("INFISICAL_PROJECT_ID=");
  lines.push("# @type=string @internal");
  lines.push(`INFISICAL_ENVIRONMENT=${config.environment}`);
  lines.push("# @type=string @internal");
  lines.push(`INFISICAL_SITE_URL=${getSiteUrl(config)}`);
  lines.push("# @type=infisicalClientId @internal");
  lines.push("INFISICAL_CLIENT_ID=");
  lines.push("# @type=infisicalClientSecret @sensitive @internal");
  lines.push("INFISICAL_CLIENT_SECRET=");
  lines.push("");

  // Add secrets for each enabled service
  for (const serviceMapping of config.services) {
    const service = serviceMapping.service;
    const keys = SERVICE_SECRET_KEYS[service] ?? [];
    const mapping = serviceMapping.keys;

    lines.push(`# Service: ${service}`);
    lines.push("");

    for (const key of keys) {
      // Map to Infisical secret name
      const infisicalName = mapping[key] ?? key;
      const isSensitive = isSensitiveKey(key);

      lines.push(
        `# @type=string ${serviceMapping.required ? "@required" : ""} ${isSensitive ? "@sensitive" : ""}`
      );
      lines.push(`${key}=infisical("${infisicalName}")`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get site URL from config
 */
function getSiteUrl(config: InfisicalConfig): string {
  switch (config.site) {
    case "us":
      return "https://app.infisical.com";
    case "eu":
      return "https://eu.infisical.com";
    case "custom":
      return config.customSiteUrl ?? "https://app.infisical.com";
  }
}

/**
 * Check if a key is sensitive
 */
function isSensitiveKey(key: string): boolean {
  const sensitivePatterns = [
    /API[_-]?KEY$/i,
    /SECRET$/i,
    /TOKEN$/i,
    /PASSWORD$/i,
    /CREDENTIAL$/i,
  ];

  return sensitivePatterns.some(pattern => pattern.test(key));
}

/**
 * Validate schema doesn't contain dangerous content
 */
export function validateSchemaContent(schema: string): { valid: boolean; error?: string } {
  // Check for obvious injection patterns
  const dangerous = [
    /\$\{.*\}/,                    // Variable interpolation
    /`[^`]*`/,                     // Backtick commands
    /\|\s*\w+/,                    // Pipe to command
    /;\s*\w+/,                      // Command chaining
    /&&\s*\w+/,                    // And chaining
    /\|\|\s*\w+/,                  // Or chaining
  ];

  for (const pattern of dangerous) {
    if (pattern.test(schema)) {
      return {
        valid: false,
        error: `Schema contains potentially dangerous pattern: ${pattern.toString()}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get default secret name mapping for a service
 */
export function getDefaultMapping(service: ServiceName): Record<string, string> {
  const keys = SERVICE_SECRET_KEYS[service] ?? [];
  const mapping: Record<string, string> = {};

  for (const key of keys) {
    // Default mapping: same name in Infisical
    mapping[key] = key;
  }

  return mapping;
}

/**
 * Check if a service has all required keys
 */
export function validateServiceMapping(
  service: ServiceName,
  mapping: Record<string, string>
): { valid: boolean; missing?: string[] } {
  const requiredKeys = SERVICE_SECRET_KEYS[service] ?? [];
  const missing: string[] = [];

  for (const key of requiredKeys) {
    if (!mapping[key]) {
      missing.push(key);
    }
  }

  return missing.length > 0 ? { valid: false, missing } : { valid: true };
}
