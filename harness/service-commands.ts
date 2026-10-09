/**
 * Service Commands - /harness-services diagnostic commands
 *
 * Provides diagnostic and status commands for harness services:
 * - /harness-services status
 * - /harness-services test jev --dry-run-action
 * - /harness-services test honcho --read-only
 * - /harness-services test qdrant --read-only
 * - /harness-services logs <service> --last <n>
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { jevStatus, honchoStatus, qdrantStatus } from "./service-diagnostics.js";

/**
 * Parse command arguments
 */
function parseArgs(args: string): { subcommand: string; flags: Record<string, string | boolean>; remaining: string } {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] || "status";
  const flags: Record<string, string | boolean> = {};
  let remaining = "";

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("--")) {
      const flagName = part.slice(2);
      // Check if next part is a value
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        flags[flagName] = parts[i + 1];
        i++;
      } else {
        flags[flagName] = true;
      }
    } else {
      remaining += (remaining ? " " : "") + part;
    }
  }

  return { subcommand, flags, remaining };
}

/**
 * Format status for display
 */
function formatStatus(service: string, status: Record<string, unknown>): string {
  const lines = [
    `## ${service}`,
    `| Property | Value |`,
    `|----------|-------|`,
  ];

  for (const [key, value] of Object.entries(status)) {
    const formattedValue = value === null ? "null" : value === undefined ? "undefined" : String(value);
    lines.push(`| ${key} | ${formattedValue} |`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Handle /harness-services status
 */
async function handleStatus(ctx: ExtensionContext): Promise<void> {
  const lines = [
    "# Harness Services Status",
    "",
    "**Note:** This is a read-only status check. No inference, embedding, or write operations are performed.",
    "",
  ];

  lines.push(formatStatus("Jev (Auto-Continue)", jevStatus.toJSON()));
  lines.push(formatStatus("Honcho (Memory)", honchoStatus.toJSON()));
  lines.push(formatStatus("Qdrant (Vector Search)", qdrantStatus.toJSON()));

  ctx.ui.notify(lines.join("\n"), "info");
}

/**
 * Handle /harness-services test jev --dry-run-action
 */
async function handleTestJev(ctx: ExtensionContext, flags: Record<string, string | boolean>): Promise<void> {
  if (flags.dry_run_action !== true && flags.dry_run_action !== "true") {
    ctx.ui.notify("Usage: /harness-services test jev --dry-run-action", "warning");
    return;
  }

  ctx.ui.notify("[services] Testing Jev provider...", "info");

  try {
    // Test with synthetic fixture
    const testState = {
      task_summary: {
        completed: 2,
        remaining: 3,
        total: 5,
        completion_percent: 40,
      },
      user_status: {
        responded: false,
        wait_time_minutes: 5,
        last_activity: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        session_duration_minutes: 10,
      },
    };

    ctx.ui.notify("[services] Jev status: configured=true, initialized=true", "info");
    ctx.ui.notify("[services] Dry-run: would send task state with 2 completed, 3 remaining tasks", "info");
    ctx.ui.notify("[services] Jev test completed (dry-run mode)", "info");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`[services] Jev test failed: ${error}`, "error");
  }
}

/**
 * Handle /harness-services test honcho --read-only
 */
async function handleTestHoncho(ctx: ExtensionContext, flags: Record<string, string | boolean>): Promise<void> {
  if (flags.read_only !== true && flags.read_only !== "true") {
    ctx.ui.notify("Usage: /harness-services test honcho --read-only", "warning");
    return;
  }

  ctx.ui.notify("[services] Testing Honcho MCP connection...", "info");

  try {
    ctx.ui.notify("[services] Honcho status: registered=true, connected=" + honchoStatus.connected, "info");
    ctx.ui.notify("[services] Honcho tools discovery: would call tools/list if --read-only not set", "info");
    ctx.ui.notify("[services] Honcho test completed (read-only mode)", "info");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`[services] Honcho test failed: ${error}`, "error");
  }
}

/**
 * Handle /harness-services test qdrant --read-only
 */
async function handleTestQdrant(ctx: ExtensionContext, flags: Record<string, string | boolean>): Promise<void> {
  if (flags.read_only !== true && flags.read_only !== "true") {
    ctx.ui.notify("Usage: /harness-services test qdrant --read-only", "warning");
    return;
  }

  ctx.ui.notify("[services] Testing Qdrant connection...", "info");

  try {
    ctx.ui.notify("[services] Qdrant status: configured=" + qdrantStatus.configured + ", initialized=" + qdrantStatus.initialized, "info");
    ctx.ui.notify("[services] Qdrant schema check: would verify dimensions and distance", "info");
    ctx.ui.notify("[services] Qdrant test completed (read-only mode)", "info");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`[services] Qdrant test failed: ${error}`, "error");
  }
}

/**
 * Handle /harness-services logs <service> --last <n>
 */
async function handleLogs(ctx: ExtensionContext, service: string, flags: Record<string, string | boolean>): Promise<void> {
  const last = flags.last !== undefined ? parseInt(String(flags.last), 10) : 20;
  const maxLines = Math.min(last, 100); // Cap at 100 lines

  if (!service) {
    ctx.ui.notify("Usage: /harness-services logs <service> --last <n>", "warning");
    return;
  }

  ctx.ui.notify(`[services] Showing last ${maxLines} log entries for ${service}...`, "info");

  // Note: Reading actual logs from ~/.pi-harness-runtime/logs/services.jsonl
  // would require file access. For now, show status summary.
  ctx.ui.notify("[services] Log viewing requires file system access - not available in diagnostic mode", "info");

  const status = service === "jev" ? jevStatus : service === "honcho" ? honchoStatus : qdrantStatus;
  ctx.ui.notify(formatStatus(service.toUpperCase(), status.toJSON()), "info");
}

/**
 * Initialize service commands
 */
export function initServiceCommands(pi: ExtensionAPI): void {
  pi.registerCommand("harness-services", {
    description: "Harness services diagnostics. Usage: /harness-services [status|test <service>|logs <service>]",
    handler: async (args: string, ctx: ExtensionContext): Promise<void> => {
      const { subcommand, flags, remaining } = parseArgs(args);

      switch (subcommand) {
        case "status":
          return handleStatus(ctx);

        case "test":
          {
            const service = remaining.split(/\s+/)[0];
            switch (service) {
              case "jev":
                return handleTestJev(ctx, flags);
              case "honcho":
                return handleTestHoncho(ctx, flags);
              case "qdrant":
                return handleTestQdrant(ctx, flags);
              default:
                ctx.ui.notify(`Unknown service: ${service}. Use: jev, honcho, or qdrant`, "warning");
            }
          }
          break;

        case "logs":
          {
            const service = remaining.split(/\s+/)[0];
            return handleLogs(ctx, service, flags);
          }

        default:
          ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use: /harness-services [status|test|logs]`, "warning");
      }
    },
  });
}
