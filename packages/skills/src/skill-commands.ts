/**
 * Skill Commands - /skill:name slash command handler
 * 
 * Registers /skill:name commands for explicit skill invocation.
 * Based on pi.dev skill command specification.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getGlobalSkillRegistry } from "./loader.js";
import { scanForSkillsSync } from "./scanner.js";

/**
 * Skill command configuration
 */
export interface SkillCommandConfig {
  /** Enable skill commands */
  enabled: boolean;
  /** Prefix for skill commands (default: "skill:") */
  prefix: string;
}

/**
 * Default configuration
 */
export const DEFAULT_COMMAND_CONFIG: SkillCommandConfig = {
  enabled: true,
  prefix: "skill:",
};

/**
 * Initialize skill commands with ExtensionAPI
 */
export function initSkillCommands(
  pi: ExtensionAPI,
  config?: Partial<SkillCommandConfig>
): void {
  const cfg = { ...DEFAULT_COMMAND_CONFIG, ...config };

  if (!cfg.enabled) return;

  const registry = getGlobalSkillRegistry();

  // Initialize registry with existing skills
  const result = scanForSkillsSync();
  for (const skill of result.skills) {
    registry.register(skill);
  }

  // Register /skill command for listing
  pi.registerCommand("skill", {
    description: "Interact with skills. Usage: /skill [list|search <query>|info <name>]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0] || "list";
      const query = parts.slice(1).join(" ");

      switch (subcommand) {
        case "list":
          return handleSkillList(registry, ctx as ExtensionCommandContext);
        case "search":
          return handleSkillSearch(registry, query, ctx as ExtensionCommandContext);
        case "info":
          return handleSkillInfo(registry, query, ctx as ExtensionCommandContext);
        default:
          ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use: /skill [list|search|info]`, "warning");
      }
    },
  });

  // Register individual skill commands dynamically
  registerSkillCommands(pi, registry, cfg.prefix);
}

/**
 * Register individual skill commands
 */
function registerSkillCommands(
  pi: ExtensionAPI,
  registry: ReturnType<typeof getGlobalSkillRegistry>,
  prefix: string
): void {
  // Get all registered skills
  const skills = registry.list();

  for (const skill of skills) {
    const commandName = `${prefix}${skill.id}`;

    // Skip if command name is too long or conflicts
    if (commandName.length > 50) continue;

    // Register the command
    try {
      pi.registerCommand(commandName, {
        description: skill.frontmatter.description,
        handler: async (_skillArgs: string, ctx: ExtensionContext) => {
          // Load the full skill content
          const loaded = await registry.load(skill.id, {
            loadReferences: true,
            loadExamples: true,
          });

          if (!loaded) {
            ctx.ui.notify(`Skill not found: ${skill.id}`, "error");
            return;
          }

          // Build response with skill content
          const response: string[] = [];
          response.push(`# ${loaded.frontmatter.name}`);
          response.push(`**${loaded.frontmatter.description}**`);
          response.push("");
          response.push("---");
          response.push(loaded.body);

          // Append references
          if (loaded.references.length > 0) {
            response.push("");
            response.push("## References");
            for (const ref of loaded.references) {
              response.push(`- ${ref.relativePath}`);
            }
          }

          // Show skill details
          ctx.ui.notify(
            `Skill '${loaded.frontmatter.name}' - ${loaded.body.length} chars. ` +
            `Use /skill info ${loaded.id} for full details.`,
            "info"
          );
        },
      });
    } catch (err) {
      // Skip if command registration fails (e.g., name conflict)
      console.debug(`[SkillCommands] Skipped registering ${commandName}:`, err);
    }
  }
}

/**
 * Handle /skill list
 */
async function handleSkillList(
  registry: ReturnType<typeof getGlobalSkillRegistry>,
  ctx: ExtensionCommandContext
): Promise<void> {
  const skills = registry.list();

  if (skills.length === 0) {
    ctx.ui.notify("No skills registered. Skills are loaded from ~/.pi-harness/skills/, skills/, or .agents/skills/", "info");
    return;
  }

  const lines: string[] = ["# Available Skills", ""];

  for (const skill of skills) {
    const author = skill.hermes?.author ?? "unknown";
    const usage = skill.hermes?.usage_count ?? 0;
    lines.push(`## ${skill.frontmatter.name} ${author === "agent" ? "(agent)" : author === "curator" ? "(curator)" : ""}`);
    lines.push(skill.frontmatter.description);
    lines.push(`- Usage: ${usage}x`);
    if (skill.hermes?.triggers?.length) {
      lines.push(`- Triggers: ${skill.hermes.triggers.join(", ")}`);
    }
    lines.push("");
  }

  // Send as a message using the context's session if available
  ctx.ui.notify(`Found ${skills.length} skills. Use /skill info <name> for details.`, "info");
}

/**
 * Handle /skill search
 */
async function handleSkillSearch(
  registry: ReturnType<typeof getGlobalSkillRegistry>,
  query: string,
  ctx: ExtensionCommandContext
): Promise<void> {
  if (!query) {
    ctx.ui.notify("Usage: /skill search <query>", "warning");
    return;
  }

  const results = registry.find(query, { threshold: 0.2 });


  if (results.length === 0) {
    ctx.ui.notify(`No skills found matching: ${query}`, "info");
    return;
  }


  const lines: string[] = [`# Skills matching: ${query}`, ""];

  for (const result of results.slice(0, 10)) {
    lines.push(`## ${result.skill.frontmatter.name} (${Math.round(result.score * 100)}% match)`);
    lines.push(result.skill.frontmatter.description);
    if (result.matchedTriggers.length > 0) {
      lines.push(`Matched: ${result.matchedTriggers.join(", ")}`);
    }
    lines.push("");
  }

  ctx.ui.notify(`Found ${results.length} matching skills. Use /skill info <name> for details.`, "info");
}

/**
 * Handle /skill info
 */
async function handleSkillInfo(
  registry: ReturnType<typeof getGlobalSkillRegistry>,
  skillName: string,
  ctx: ExtensionCommandContext
): Promise<void> {
  if (!skillName) {
    ctx.ui.notify("Usage: /skill info <name>", "warning");
    return;
  }

  const skill = registry.get(skillName);

  if (!skill) {
    ctx.ui.notify(`Skill not found: ${skillName}`, "error");
    return;
  }

  // Load full content
  const loaded = await registry.load(skill.id, { loadReferences: true });

  if (!loaded) {
    ctx.ui.notify(`Failed to load skill: ${skillName}`, "error");
    return;
  }

  const lines: string[] = [];
  lines.push(`# ${loaded.frontmatter.name}`);
  lines.push("");
  lines.push("**Description:** " + loaded.frontmatter.description);
  if (loaded.frontmatter.version) {
    lines.push("**Version:** " + loaded.frontmatter.version);
  }
  if (loaded.hermes?.author) {
    lines.push("**Author:** " + loaded.hermes.author);
  }
  if (loaded.hermes?.confidence !== undefined) {
    lines.push("**Confidence:** " + Math.round(loaded.hermes.confidence * 100) + "%");
  }
  if (loaded.hermes?.usage_count !== undefined) {
    lines.push("**Used:** " + loaded.hermes.usage_count + " times");
  }

  lines.push("");
  lines.push("## Content");
  lines.push(loaded.body);

  if (loaded.references.length > 0) {
    lines.push("");
    lines.push("## References");
    for (const ref of loaded.references) {
      lines.push(`- ${ref.relativePath}`);
    }
  }

  if (loaded.hermes?.pitfalls?.length) {
    lines.push("");
    lines.push("## Pitfalls");
    for (const pitfall of loaded.hermes.pitfalls) {
      lines.push(`- **${pitfall.name}**: ${pitfall.why}`);
    }
  }

  // Show skill content via notification (simplified approach)
  ctx.ui.notify(`Skill '${loaded.frontmatter.name}' loaded with ${loaded.body.length} chars. Use /skill:${skill.id} to activate.`, "info");
}

/**
 * Get skill index for system prompt injection
 */
export function getSkillIndexForSystemPrompt(): string {
  const registry = getGlobalSkillRegistry();
  const skills = registry.list();

  if (skills.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("## Available Skills");
  lines.push("");

  for (const skill of skills) {
    lines.push(`- **${skill.frontmatter.name}**: ${skill.frontmatter.description}`);
    if (skill.hermes?.triggers?.length) {
      lines.push(`  Triggers: ${skill.hermes.triggers.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("Use `/skill:name` to activate a skill.");

  return lines.join("\n");
}

/**
 * Refresh skill commands (re-register after skills change)
 */
export function refreshSkillCommands(
  pi: ExtensionAPI,
  prefix?: string
): void {
  const cfg: SkillCommandConfig = {
    enabled: true,
    prefix: prefix ?? DEFAULT_COMMAND_CONFIG.prefix,
  };

  const registry = getGlobalSkillRegistry();
  registerSkillCommands(pi, registry, cfg.prefix);
}
