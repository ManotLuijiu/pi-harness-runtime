/**
 * Wiki Integration for Pi
 *
 * Implements wiki commands per wiki/llm-wiki-integration-minimax-plan.md
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Initialize wiki integration
 */
export async function initWiki(pi: ExtensionAPI): Promise<void> {
  // Only initialize if feature flag is set
  if (process.env.HARNESS_KNOWLEDGE_WIKI !== "1") {
    return;
  }

  try {
    const { createWikiManager, isWikiEnabled } = await import(
      "../packages/wiki/dist/index.js"
    );

    // Get workspace from environment
    const workspaceRoot = process.env.PWD || process.cwd();

    // Create wiki manager lazily
    let wikiManager: ReturnType<typeof createWikiManager> | null = null;

    function getWiki() {
      if (!wikiManager) {
        wikiManager = createWikiManager(workspaceRoot, "pi-harness-runtime");
      }
      return wikiManager;
    }

    // Register /harness-wiki command
    pi.registerCommand("harness-wiki", {
      description: "Manage project wiki: search, read, ingest, lint",
      handler: async (args: string, _ctx: unknown) => {
        if (!isWikiEnabled()) {
          console.log("Wiki feature is disabled. Set HARNESS_KNOWLEDGE_WIKI=1 to enable.");
          return;
        }

        const wiki = getWiki();
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
              const { snapshot, existing } = wiki.ingestSource(subargs);
              if (existing) {
                console.log(`Already ingested: ${snapshot.id}`);
              } else {
                console.log(`Ingested: ${snapshot.id}`);
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
                const errors = findings.filter((f) => f.severity === "error");
                const warnings = findings.filter((f) => f.severity === "warning");
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

Project knowledge is available via the wiki. Use /harness-wiki to:
- Search: /harness-wiki search <query>
- Read: /harness-wiki read <page-id>
- Ingest: /harness-wiki ingest <source-path>

The wiki contains:
- Design decisions with rationale
- Architecture concepts
- Incident records and lessons
- Implementation plans

Always cite wiki sources when providing project-specific information.
`;
}
