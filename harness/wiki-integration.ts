/**
 * Wiki Integration for Pi
 *
 * Implements wiki commands and tools per wiki/llm-wiki-integration-minimax-plan.md
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { realpathSync } from "node:fs";
import path from "node:path";

// Cache managers by workspace root to avoid recreating
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Cache managers by workspace root to avoid recreating
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wikiManagers = new Map<string, any>();

// Pre-load the wiki module for ESM compatibility
let wikiModule: typeof import("../packages/wiki/dist/index.js") | null = null;
async function getWikiModule() {
  if (!wikiModule) {
    wikiModule = await import("../packages/wiki/dist/index.js");
  }
  return wikiModule;
}

/**
 * Get or create wiki manager for a workspace
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWiki(workspaceRoot: string): Promise<any> {
  let manager = wikiManagers.get(workspaceRoot);
  if (!manager) {
    const mod = await getWikiModule();
    const projectId = path.basename(workspaceRoot) || "unknown";
    manager = mod.createWikiManager(workspaceRoot, projectId);
    wikiManagers.set(workspaceRoot, manager);
  }
  return manager;
}

/**
 * Get current workspace from Pi context
 */
function getCurrentWorkspace(ctx?: ExtensionContext): string {
  if (ctx?.cwd) {
    try {
      return realpathSync(ctx.cwd);
    } catch {
      return ctx.cwd;
    }
  }
  try {
    return realpathSync(process.cwd());
  } catch {
    return process.cwd();
  }
}

/**
 * Initialize wiki integration
 */
export async function initWiki(pi: ExtensionAPI): Promise<void> {
  // Only initialize if feature flag is set
  if (process.env.HARNESS_KNOWLEDGE_WIKI !== "1") {
    return;
  }

  try {
    const { isWikiEnabled } = await import("../packages/wiki/dist/index.js");

    // ========================================================================
    // Register Tools (for LLM use)
    // ========================================================================

    // Tool: wiki_search - Search pages by query
    pi.registerTool({
      name: "wiki_search",
      label: "Wiki Search",
      description: "Search wiki pages by query. Returns page titles, IDs, status, and snippets.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default 5)", default: 5 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!isWikiEnabled()) {
          return { content: [{ type: "text", text: "Wiki feature is disabled." }], details: {} };
        }
        try {
          const wiki = await getWiki(getCurrentWorkspace(ctx));
          const results = wiki.search(params.query, undefined, params.limit ?? 5);
          if (results.length === 0) {
            return { content: [{ type: "text", text: "No results found." }], details: {} };
          }
          const lines = results.map((r: { page: { status: string; title: string; kind: string; id: string } }) =>
            `[${r.page.status}] ${r.page.title} (${r.page.kind}): ${r.page.id}`
          );
          return { content: [{ type: "text", text: `Found ${results.length} result(s):\n${lines.join("\n")}` }], details: {} };
        } catch (err) {
          return { content: [{ type: "text", text: `Search failed: ${err}` }], details: {} };
        }
      },
    });

    // Tool: wiki_read - Read a specific page
    pi.registerTool({
      name: "wiki_read",
      label: "Wiki Read",
      description: "Read a wiki page by ID. Returns frontmatter and body content.",
      parameters: Type.Object({
        pageId: Type.String({ description: "Page ID to read" }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!isWikiEnabled()) {
          return { content: [{ type: "text", text: "Wiki feature is disabled." }], details: {} };
        }
        try {
          const wiki = await getWiki(getCurrentWorkspace(ctx));
          const page = wiki.loadPage(params.pageId);
          if (!page) {
            return { content: [{ type: "text", text: `Page not found: ${params.pageId}` }], details: {} };
          }
          const lines = [
            `# ${page.frontmatter.title}`,
            `ID: ${page.frontmatter.id}`,
            `Status: ${page.frontmatter.status}`,
            `Kind: ${page.frontmatter.kind}`,
            `Updated: ${page.frontmatter.updatedAt}`,
            ``,
            `---`,
            page.body,
          ];
          return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
        } catch (err) {
          return { content: [{ type: "text", text: `Read failed: ${err}` }], details: {} };
        }
      },
    });

    // Tool: wiki_ingest - Ingest a source file
    pi.registerTool({
      name: "wiki_ingest",
      label: "Wiki Ingest",
      description: "Ingest a source file into the wiki. Creates a snapshot and returns the snapshot ID.",
      parameters: Type.Object({
        sourcePath: Type.String({ description: "Path to source file to ingest" }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!isWikiEnabled()) {
          return { content: [{ type: "text", text: "Wiki feature is disabled." }], details: {} };
        }
        try {
          const wiki = await getWiki(getCurrentWorkspace(ctx));
          const { page, snapshot, existing } = wiki.ingestAndCreatePage(params.sourcePath);
          if (existing) {
            return { content: [{ type: "text", text: `Already ingested: ${snapshot.id}` }], details: {} };
          }
          return {
            content: [{
              type: "text",
              text: `Ingested: ${snapshot.id}\nPage: ${page.frontmatter.id}\nTitle: ${page.frontmatter.title}\nPath: ${snapshot.originalPath}\nHash: ${snapshot.contentHash.slice(0, 16)}...`,
            }],
            details: { pageId: page.frontmatter.id },
          };
        } catch (err) {
          return { content: [{ type: "text", text: `Ingest failed: ${err}` }], details: {} };
        }
      },
    });

    // Tool: wiki_lint - Run lint checks
    pi.registerTool({
      name: "wiki_lint",
      label: "Wiki Lint",
      description: "Run lint checks on the wiki. Returns structural and semantic issues.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        if (!isWikiEnabled()) {
          return { content: [{ type: "text", text: "Wiki feature is disabled." }], details: {} };
        }
        try {
          const wiki = await getWiki(getCurrentWorkspace(ctx));
          const findings = wiki.lint();
          if (findings.length === 0) {
            return { content: [{ type: "text", text: "No issues found." }], details: {} };
          }
          const lines = findings.slice(0, 20).map((f: { severity: string; category: string; message: string }) =>
            `[${f.severity}] ${f.category}: ${f.message}`
          );
          return { content: [{ type: "text", text: `${findings.length} issue(s):\n${lines.join("\n")}` }], details: {} };
        } catch (err) {
          return { content: [{ type: "text", text: `Lint failed: ${err}` }], details: {} };
        }
      },
    });

    // Tool: wiki_status - Show wiki stats
    pi.registerTool({
      name: "wiki_status",
      label: "Wiki Status",
      description: "Show wiki statistics: page count, kinds, statuses.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        if (!isWikiEnabled()) {
          return { content: [{ type: "text", text: "Wiki feature is disabled." }], details: {} };
        }
        try {
          const wiki = await getWiki(getCurrentWorkspace(ctx));
          const pages = wiki.getAllPages();
          const kinds: Record<string, number> = {};
          const statuses: Record<string, number> = {};
          for (const p of pages) {
            kinds[p.frontmatter.kind] = (kinds[p.frontmatter.kind] || 0) + 1;
            statuses[p.frontmatter.status] = (statuses[p.frontmatter.status] || 0) + 1;
          }
          return {
            content: [{
              type: "text",
              text: `Wiki Status\nPages: ${pages.length}\nKinds: ${JSON.stringify(kinds)}\nStatuses: ${JSON.stringify(statuses)}`,
            }],
            details: {},
          };
        } catch (err) {
          return { content: [{ type: "text", text: `Status failed: ${err}` }], details: {} };
        }
      },
    });

    // ========================================================================
    // Register Command (for user use)
    // ========================================================================

    pi.registerCommand("harness-wiki", {
      description: "Manage project wiki: search, read, ingest, lint",
      handler: async (args: string, ctx: unknown) => {
        if (!isWikiEnabled()) {
          console.log("Wiki feature is disabled. Set HARNESS_KNOWLEDGE_WIKI=1 to enable.");
          return;
        }

        // Get workspace from context
        const extCtx = ctx as ExtensionContext | undefined;
        const workspace = getCurrentWorkspace(extCtx);
        const wiki = await getWiki(workspace);
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0] || "help";
        const subargs = parts.slice(1).join(" ");

        switch (subcommand) {
          case "init":
            try {
              const result = wiki.initialize();
              if (result.created) {
                console.log("Wiki initialized.");
              } else {
                console.log("Wiki already exists.");
              }
              console.log(`  Root: ${result.config.wikiRoot}`);
            } catch (err) {
              console.log(`Init failed: ${err}`);
            }
            break;

          case "search":
            if (!subargs) {
              console.log("Usage: /harness-wiki search <query>");
              return;
            }
            try {
              const results = wiki.search(subargs);
              if (results.length === 0) {
                console.log("No results found.");
              } else {
                console.log(`Found ${results.length} result(s):`);
                for (const r of results.slice(0, 5)) {
                  console.log(`  - [${r.page.status}] ${r.page.title} (${r.page.kind})`);
                }
              }
            } catch (err) {
              console.log(`Search failed: ${err}`);
            }
            break;

          case "read":
            if (!subargs) {
              console.log("Usage: /harness-wiki read <page-id>");
              return;
            }
            try {
              const page = wiki.loadPage(subargs);
              if (!page) {
                console.log(`Page not found: ${subargs}`);
              } else {
                console.log(`# ${page.frontmatter.title}`);
                console.log(`Status: ${page.frontmatter.status}`);
                console.log(`Kind: ${page.frontmatter.kind}`);
                console.log(`Updated: ${page.frontmatter.updatedAt}`);
                console.log("");
                console.log(page.body.slice(0, 500) + (page.body.length > 500 ? "..." : ""));
              }
            } catch (err) {
              console.log(`Read failed: ${err}`);
            }
            break;

          case "ingest":
            if (!subargs) {
              console.log("Usage: /harness-wiki ingest <source-path>");
              return;
            }
            try {
              const { page, snapshot, existing } = wiki.ingestAndCreatePage(subargs);
              if (existing) {
                console.log(`Already ingested: ${snapshot.id}`);
              } else {
                console.log(`Ingested: ${snapshot.id}`);
                console.log(`  Page: ${page.frontmatter.id} - ${page.frontmatter.title}`);
                console.log(`  Path: ${snapshot.originalPath}`);
                console.log(`  Hash: ${snapshot.contentHash.slice(0, 16)}...`);
              }
            } catch (err) {
              console.log(`Ingest failed: ${err}`);
            }
            break;

          case "lint":
            try {
              const findings = wiki.lint();
              if (findings.length === 0) {
                console.log("No issues found.");
              } else {
                const errors = findings.filter((f: { severity: string }) => f.severity === "error");
                const warnings = findings.filter((f: { severity: string }) => f.severity === "warning");
                console.log(`${errors.length} error(s), ${warnings.length} warning(s):`);
                for (const f of findings.slice(0, 10)) {
                  console.log(`  [${f.severity}] ${f.category}: ${f.message}`);
                }
              }
            } catch (err) {
              console.log(`Lint failed: ${err}`);
            }
            break;

          case "status":
            try {
              const pages = wiki.getAllPages();
              const index = wiki.getIndex();
              const kinds: Record<string, number> = {};
              const statuses: Record<string, number> = {};
              for (const p of index) {
                kinds[p.kind] = (kinds[p.kind] || 0) + 1;
                statuses[p.status] = (statuses[p.status] || 0) + 1;
              }
              console.log("Wiki Status");
              console.log(`  Pages: ${pages.length}`);
              console.log(`  Kinds: ${JSON.stringify(kinds)}`);
              console.log(`  Statuses: ${JSON.stringify(statuses)}`);
            } catch (err) {
              console.log(`Status failed: ${err}`);
            }
            break;

          case "help":
          default:
            console.log("Wiki Commands:");
            console.log("  /harness-wiki init         - Initialize wiki");
            console.log("  /harness-wiki search <q>  - Search pages");
            console.log("  /harness-wiki read <id>   - Read page");
            console.log("  /harness-wiki ingest <p> - Ingest source file");
            console.log("  /harness-wiki lint        - Check for issues");
            console.log("  /harness-wiki status      - Show stats");
            break;
        }
      },
    });
  } catch {
    // Silently fail - wiki is optional
  }
}

/**
 * Get wiki context for injection into system prompt
 */
export function getWikiInstruction(): string {
  if (process.env.HARNESS_KNOWLEDGE_WIKI !== "1") {
    return "";
  }

  return `
## Project Wiki

Project knowledge is available via wiki tools:
- wiki_search: Search pages by query
- wiki_read: Read a page by ID
- wiki_ingest: Ingest a source file
- wiki_lint: Check for issues
- wiki_status: Show statistics

The wiki contains:
- Design decisions with rationale
- Architecture concepts
- Incident records and lessons
- Implementation plans

Always cite wiki sources when providing project-specific information.
`;
}
