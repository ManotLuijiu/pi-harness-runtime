/**
 * Journey Renderer - ASCII timeline visualization of learning
 * 
 * Renders the learning journey as an ASCII timeline.
 * Based on Hermes Agent's Learning Journey visualization.
 */

import type { LearningNode, NodeType } from "./learning-graph.js";
import { getGlobalLearningGraph } from "./learning-graph.js";

/**
 * Render options
 */
export interface JourneyRenderOptions {
  /** Maximum width */
  width: number;
  /** Maximum height */
  height: number;
  /** Show colors */
  color: boolean;
  /** Show all nodes or recent only */
  showAll: boolean;
  /** Limit to specific type */
  type?: NodeType;
  /** Limit to recent N nodes */
  limit?: number;
}

/**
 * Default render options
 */
export const DEFAULT_RENDER_OPTIONS: JourneyRenderOptions = {
  width: 80,
  height: 40,
  color: true,
  showAll: false,
};

/**
 * Color codes
 */
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  skill: "\x1b[36m", // cyan
  memory: "\x1b[33m", // yellow
  pattern: "\x1b[32m", // green
  antiPattern: "\x1b[31m", // red
  date: "\x1b[90m", // gray
  accent: "\x1b[94m", // blue
};

/**
 * Get color for node type
 */
function getColor(type: NodeType, color: boolean): string {
  if (!color) return "";
  switch (type) {
    case "skill":
      return COLORS.skill;
    case "memory":
      return COLORS.memory;
    case "pattern":
      return COLORS.pattern;
    case "anti-pattern":
      return COLORS.antiPattern;
    default:
      return "";
  }
}

/**
 * Get icon for node type
 */
function getIcon(type: NodeType): string {
  switch (type) {
    case "skill":
      return "[S]";
    case "memory":
      return "[M]";
    case "pattern":
      return "[P]";
    case "anti-pattern":
      return "[!]";
    default:
      return "[?]";
  }
}

/**
 * Format date for display
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Render a single node
 */
function renderNode(node: LearningNode, options: JourneyRenderOptions): string[] {
  const lines: string[] = [];
  const color = getColor(node.type, options.color);
  const icon = getIcon(node.type);
  const reset = options.color ? COLORS.reset : "";

  // Calculate available width for content
  const headerWidth = options.width - 8;
  const dateWidth = 14;
  const contentWidth = headerWidth - dateWidth - 4;

  // Header line
  const header = `${color}${icon}${reset} ${color}${truncate(node.name, contentWidth - icon.length - 1)}${reset}`;
  const dateStr = `${COLORS.date}${formatDate(node.created_at)}${reset}`;
  lines.push(`${header.padEnd(headerWidth)}${dateStr}`);

  // Description (if present and space allows)
  if (node.description && options.height > 2) {
    const descLines = wrapText(node.description, contentWidth - 2);
    for (const line of descLines.slice(0, 2)) {
      lines.push(
        `${color}  ${truncate(line, contentWidth - 2)}${reset}`
      );
    }
  }

  // Metadata line
  const metaParts: string[] = [];
  if (node.usage_count > 0) {
    metaParts.push(`${node.usage_count} uses`);
  }
  if (node.confidence !== undefined) {
    metaParts.push(`${Math.round(node.confidence * 100)}% confidence`);
  }
  if (node.author) {
    metaParts.push(`by ${node.author}`);
  }
  if (node.created_from) {
    metaParts.push(`from trajectory`);
  }

  if (metaParts.length > 0 && options.height > 3) {
    lines.push(
      `${COLORS.dim}  ${metaParts.join(" | ")}${reset}`
    );
  }

  return lines;
}

/**
 * Wrap text to width
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxWidth) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Render the journey timeline
 */
export function renderJourney(options?: Partial<JourneyRenderOptions>): string {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const graph = getGlobalLearningGraph();

  // Get nodes based on options
  let nodes: LearningNode[];
  if (opts.type) {
    nodes = graph.getRecent(opts.type, opts.limit);
  } else if (opts.showAll) {
    nodes = graph.getTimeline();
  } else {
    nodes = graph.getTimeline(opts.limit ?? 20);
  }

  // Build output
  const lines: string[] = [];

  // Header
  const border = "═".repeat(Math.min(opts.width, 80));
  lines.push(`${COLORS.accent}${border}${COLORS.reset}`);
  lines.push(
    `${COLORS.bold}LEARNING JOURNEY${COLORS.reset}`.padStart(Math.floor((opts.width + 16) / 2))
  );
  lines.push(`${COLORS.accent}${border}${COLORS.reset}`);

  // Stats line
  const stats = graph.getStats();
  lines.push(
    `${COLORS.dim}${stats.totalNodes} items learned | ${stats.byType.skill} skills | ${stats.byType.memory} memories | ${stats.byType.pattern} patterns${COLORS.reset}`
  );
  lines.push("");

  // Legend
  lines.push(`${COLORS.skill}[S] Skill${COLORS.reset}  ${COLORS.memory}[M] Memory${COLORS.reset}  ${COLORS.pattern}[P] Pattern${COLORS.reset}  ${COLORS.antiPattern}[!] Anti-pattern${COLORS.reset}`);
  lines.push("");

  // Divider
  lines.push(`${COLORS.dim}${"─".repeat(Math.min(opts.width, 80))}${COLORS.reset}`);

  // Nodes
  if (nodes.length === 0) {
    lines.push(`${COLORS.dim}No learning history yet.${COLORS.reset}`);
  } else {
    const nodeLines: string[] = [];
    for (const node of nodes) {
      nodeLines.push(...renderNode(node, opts));
      nodeLines.push(""); // Empty line between nodes
    }

    // Trim and limit
    const trimmedLines = nodeLines.join("\n").split("\n").slice(0, opts.height - 10);
    lines.push(...trimmedLines);
  }

  // Footer
  lines.push("");
  lines.push(`${COLORS.dim}Use --json for raw graph data${COLORS.reset}`);

  return lines.join("\n");
}

/**
 * Render as JSON
 */
export function renderJourneyJSON(): string {
  const graph = getGlobalLearningGraph();
  return JSON.stringify(graph.getGraph(), null, 2);
}

/**
 * Render summary
 */
export function renderSummary(): string {
  const graph = getGlobalLearningGraph();
  const stats = graph.getStats();
  const lines: string[] = [];

  lines.push(`${COLORS.bold}Learning Journey Summary${COLORS.reset}`);
  lines.push("─".repeat(40));
  lines.push("");
  lines.push(`${COLORS.bold}Total Items:${COLORS.reset} ${stats.totalNodes}`);
  lines.push("");
  lines.push(`${COLORS.bold}By Type:${COLORS.reset}`);
  lines.push(`  ${COLORS.skill}Skills:${COLORS.reset} ${stats.byType.skill}`);
  lines.push(`  ${COLORS.memory}Memories:${COLORS.reset} ${stats.byType.memory}`);
  lines.push(`  ${COLORS.pattern}Patterns:${COLORS.reset} ${stats.byType.pattern}`);
  lines.push(`  ${COLORS.antiPattern}Anti-patterns:${COLORS.reset} ${stats.byType["anti-pattern"]}`);
  lines.push("");
  lines.push(`${COLORS.bold}Most Used:${COLORS.reset}`);

  for (const node of stats.mostUsed) {
    const color = getColor(node.type, true);
    const reset = COLORS.reset;
    lines.push(
      `  ${color}${node.name}${reset} (${node.usage_count} uses)`
    );
  }

  return lines.join("\n");
}

/**
 * Render node list
 */
export function renderNodeList(type?: NodeType): string {
  const graph = getGlobalLearningGraph();

  let nodes: LearningNode[];
  if (type) {
    nodes = graph.getNodesByType(type);
  } else {
    nodes = graph.getAllNodes();
  }

  if (nodes.length === 0) {
    return "No nodes found.";
  }

  const lines: string[] = [];
  lines.push(`${COLORS.bold}Nodes:${COLORS.reset}`);
  lines.push("");

  for (const node of nodes) {
    const color = getColor(node.type, true);
    const reset = COLORS.reset;
    lines.push(
      `${color}${node.id}${reset}  ${node.type}: ${node.name}`
    );
  }

  return lines.join("\n");
}

/**
 * Animate journey build-up
 */
export async function animateJourney(
  onFrame: (output: string) => void,
  options?: Partial<JourneyRenderOptions>
): Promise<void> {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const graph = getGlobalLearningGraph();
  const nodes = graph.getTimeline();

  if (nodes.length === 0) {
    onFrame(renderJourney(opts));
    return;
  }

  // Show nodes progressively
  for (let i = 0; i < Math.min(nodes.length, opts.height - 10); i++) {
    const partialGraph = nodes.slice(0, i + 1);
    const output = renderJourney({ ...opts, showAll: false });
    onFrame(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// CLI helper
export function parseJourneyArgs(args: string[]): {
  command: string;
  options: Partial<JourneyRenderOptions>;
} {
  const command = args[0] ?? "render";
  const options: Partial<JourneyRenderOptions> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        return { command: "json", options };
      case "--list":
        return { command: "list", options };
      case "--summary":
        return { command: "summary", options };
      case "--no-color":
        options.color = false;
        break;
      case "--width":
        options.width = parseInt(args[++i], 10) || 80;
        break;
      case "--height":
        options.height = parseInt(args[++i], 10) || 40;
        break;
      case "--limit":
        options.limit = parseInt(args[++i], 10) || 20;
        break;
      case "--all":
        options.showAll = true;
        break;
      case "--skill":
      case "--skills":
        options.type = "skill";
        break;
      case "--memory":
      case "--memories":
        options.type = "memory";
        break;
      case "--pattern":
      case "--patterns":
        options.type = "pattern";
        break;
    }
  }

  return { command, options };
}
