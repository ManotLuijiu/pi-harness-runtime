/**
 * Infisical Setup Command Module
 *
 * /setup-infisical - Interactive configuration wizard
 * /setup-infisical status - Show current status
 * /setup-infisical test - Test resolution
 * /setup-infisical refresh - Refresh secrets
 * /setup-infisical disable - Disable integration
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  InfisicalConfig,
  InfisicalSite,
  ServiceName,
  loadConfig,
  saveConfig,
  isConfigured,
  disableIntegration,
  getSiteUrl,
  isValidSiteUrl,
  cleanupOldRevisions,
} from "./infisical-config.js";
import {
  SecretProvider,
  getSecretProvider,
  awaitProviderReady,
} from "./secret-provider.js";
import {
  getVarlockVersion,
  resolveSecrets,
} from "./varlock-worker.js";
import { getDefaultMapping } from "./secret-schema.js";

/**
 * Parse command arguments
 */
function parseArgs(args: string): {
  subcommand: string;
  flags: Record<string, boolean | string>;
} {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] || "status";
  const flags: Record<string, boolean | string> = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.startsWith("--")) {
      const flagName = part.slice(2);
      if (i + 1 < parts.length && !parts[i + 1]!.startsWith("--")) {
        flags[flagName] = parts[i + 1]!;
        i++;
      } else {
        flags[flagName] = true;
      }
    }
  }

  return { subcommand, flags };
}

/**
 * Handle /setup-infisical status
 */
async function handleStatus(ctx: ExtensionContext): Promise<void> {
  const config = loadConfig();
  const provider = getSecretProvider();
  const state = provider.getStatus();
  const varlockVersion = await getVarlockVersion();

  const lines: string[] = [
    "# Infisical Status",
    "",
    `**Varlock version:** ${varlockVersion ?? "not found"}`,
    `**Provider status:** ${state.status}`,
    "",
  ];

  if (!config || !config.enabled) {
    lines.push("Infisical is **not configured**.");
    lines.push("");
    lines.push("**Quick setup:** Run this command to create config:");
    lines.push("");
    lines.push('```bash');
    lines.push('cat > ~/.pi-harness-runtime/infisical/config.json << \'EOF\'');
    lines.push('{');
    lines.push('  "schemaVersion": 1,');
    lines.push('  "enabled": true,');
    lines.push('  "site": "us",');
    lines.push('  "projectId": "YOUR_PROJECT_ID",');
    lines.push('  "environment": "production",');
    lines.push('  "secretPath": "/harness",');
    lines.push('  "authMethod": "universal",');
    lines.push('  "bootstrapRef": { "type": "env", "name": "INFISICAL_CLIENT_SECRET" },');
    lines.push('  "services": [');
    lines.push('    { "service": "jev", "required": true, "keys": { "TYPESAFE_API_KEY": "TYPESAFE_API_KEY" } }');
    lines.push('  ],');
    lines.push('  "sourcePolicy": { "remoteAuthoritative": true, "envOverride": false }');
    lines.push('}');
    lines.push('EOF');
    lines.push('```');
    lines.push("");
    lines.push("Then: `export INFISICAL_CLIENT_ID=xxx INFISICAL_CLIENT_SECRET=xxx`");
    lines.push("Then: `/setup-infisical refresh`");
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }

  lines.push(`**Site:** ${getSiteUrl(config)}`);
  lines.push(`**Project:** ${config.projectId}`);
  lines.push(`**Environment:** ${config.environment}`);
  lines.push(`**Secret path:** ${config.secretPath}`);
  lines.push("");
  lines.push("**Enabled services:**");

  for (const svc of config.services) {
    const required = svc.required ? "(required)" : "(optional)";
    lines.push(`- ${svc.service} ${required}`);
  }

  lines.push("");
  lines.push(`**Active revision:** ${config.activeRevision ?? "none"}`);
  lines.push(`**Last resolved:** ${config.lastResolvedAt ?? "never"}`);

  if (state.lastError) {
    lines.push("");
    lines.push(`**Last error:** ${state.lastError}`);
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

/**
 * Handle /setup-infisical test
 */
async function handleTest(ctx: ExtensionContext): Promise<void> {
  ctx.ui.notify("[setup-infisical] Testing Infisical resolution...", "info");

  const config = loadConfig();
  if (!config || !config.enabled) {
    ctx.ui.notify("[setup-infisical] Infisical not configured", "error");
    return;
  }

  // Quick test - just check Varlock version and config validity
  const varlockVersion = await getVarlockVersion();

  if (!varlockVersion) {
    ctx.ui.notify("[setup-infisical] Varlock not found - install with: npm install -g varlock", "error");
    return;
  }

  ctx.ui.notify(`[setup-infisical] Varlock ${varlockVersion} found`, "info");
  ctx.ui.notify(`[setup-infisical] Project: ${config.projectId}`, "info");
  ctx.ui.notify(`[setup-infisical] Environment: ${config.environment}`, "info");
  ctx.ui.notify("[setup-infisical] Configuration appears valid", "info");
  ctx.ui.notify("Run `/setup-infisical refresh` to resolve secrets", "info");
}

/**
 * Handle /setup-infisical refresh
 */
async function handleRefresh(ctx: ExtensionContext): Promise<void> {
  ctx.ui.notify("[setup-infisical] Refreshing secrets...", "info");

  const provider = getSecretProvider();
  const result = await provider.refresh();

  if (result.success) {
    ctx.ui.notify("[setup-infisical] Secrets refreshed successfully", "info");
  } else {
    ctx.ui.notify(`[setup-infisical] Refresh failed: ${result.error}`, "error");
  }
}

/**
 * Handle /setup-infisical disable
 */
async function handleDisable(ctx: ExtensionContext): Promise<void> {
  ctx.ui.notify("[setup-infisical] Disabling Infisical integration...", "info");

  disableIntegration();

  ctx.ui.notify("[setup-infisical] Infisical disabled", "info");
  ctx.ui.notify("Legacy key files will be used instead", "info");
}

/**
 * Handle interactive /setup-infisical wizard
 */
async function handleSetup(ctx: ExtensionContext): Promise<void> {
  // Check if already configured
  const existing = loadConfig();
  if (existing?.enabled) {
    ctx.ui.notify("Infisical is already configured.", "info");
    ctx.ui.notify("Run `/setup-infisical status` for details", "info");
    ctx.ui.notify("Run `/setup-infisical disable` to remove configuration", "info");
    return;
  }

  // Interactive setup would use ctx.ui.select/input/confirm
  // For now, show instructions
  const instructions = [
    "# Infisical Setup",
    "",
    "This wizard will help you configure Infisical integration.",
    "",
    "## Prerequisites",
    "",
    "1. Create an Infisical account at https://infisical.com",
    "2. Create a project and note the Project ID",
    "3. Create a Machine Identity with Universal Auth",
    "4. Note the Client ID and Client Secret",
    "",
    "## Configuration steps:",
    "",
    "1. Site: Choose US Cloud (https://app.infisical.com) or EU Cloud",
    "2. Enter Project ID from your Infisical project",
    "3. Enter Environment (e.g., production, development)",
    "4. Enter Secret Path (e.g., /harness)",
    "5. Choose bootstrap method:",
    "   - env:INFISICAL_CLIENT_SECRET for environment variable",
    "   - file:/path/to/client.secret for file-based bootstrap",
    "6. Select services to configure",
    "",
    "## Quick setup:",
    "",
    "Create ~/.pi-harness-runtime/infisical/config.json manually:",
    "",
    "```json",
    '{',
    '  "schemaVersion": 1,',
    '  "enabled": true,',
    '  "site": "us",',
    '  "projectId": "your-project-id",',
    '  "environment": "production",',
    '  "secretPath": "/harness",',
    '  "authMethod": "universal",',
    '  "bootstrapRef": { "type": "env", "name": "INFISICAL_CLIENT_SECRET" },',
    '  "services": [',
    '    { "service": "jev", "required": true, "keys": { "TYPESAFE_API_KEY": "TYPESAFE_API_KEY" } },',
    '    { "service": "telegram", "required": false, "keys": { "TELEGRAM_BOT_TOKEN": "TELEGRAM_BOT_TOKEN" } }',
    "  ],",
    '  "sourcePolicy": { "remoteAuthoritative": true, "envOverride": false },',
    '  "activeRevision": null,',
    '  "lastResolvedAt": null,',
    '  "lastError": null',
    "}",
    "```",
    "",
    "Then run `/setup-infisical refresh` to resolve secrets.",
  ];

  ctx.ui.notify(instructions.join("\n"), "info");
}

/**
 * Register /setup-infisical command
 */
export function registerInfisicalSetup(pi: ExtensionAPI): void {
  pi.registerCommand("setup-infisical", {
    description: "Configure Infisical secrets. Usage: /setup-infisical [status|test|refresh|disable]",
    handler: async (args: string, ctx: ExtensionContext): Promise<void> => {
      const { subcommand, flags: _flags } = parseArgs(args);

      switch (subcommand) {
        case "status":
          return handleStatus(ctx);

        case "test":
          return handleTest(ctx);

        case "refresh":
          return handleRefresh(ctx);

        case "disable":
          return handleDisable(ctx);

        case "setup":
          return handleSetup(ctx);

        default:
          if (subcommand === "") {
            return handleSetup(ctx);
          }
          ctx.ui.notify(
            `Unknown subcommand: ${subcommand}. Use: status, test, refresh, disable`,
            "warning"
          );
      }
    },
  });
}
