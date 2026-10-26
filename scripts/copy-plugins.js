/**
 * Copy herdr plugins to runtime directory
 * 
 * Copies herdr plugins from plugins/ to ~/.config/herdr/plugins/
 * The source plugins/ directory is tracked in git and included in the npm
 * package via the files array.
 *
 * Skill payloads are NOT shipped: they live in the user's own Qdrant
 * collection and in the installation-local skill store.
 */

import { mkdirSync, existsSync, readdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_PLUGINS_DIR = join(__dirname, "..", "plugins");
const HERDR_PLUGINS_DIR = join(process.env.HOME || "~", ".config", "herdr", "plugins");

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function copyPlugin(pluginName) {
  const srcDir = join(SOURCE_PLUGINS_DIR, pluginName);
  const destDir = join(HERDR_PLUGINS_DIR, pluginName);
  
  if (!existsSync(srcDir)) {
    console.log(`[copy-plugins] No source plugin: ${pluginName}, skipping`);
    return;
  }
  
  ensureDir(destDir);
  cpSync(srcDir, destDir, { recursive: true });
  
  console.log(`[copy-plugins] Copied ${pluginName} to ${destDir}`);
}

function main() {
  if (!existsSync(SOURCE_PLUGINS_DIR)) {
    console.log("[copy-plugins] No plugins/ directory found, skipping");
    return;
  }
  
  ensureDir(HERDR_PLUGINS_DIR);
  console.log(`[copy-plugins] Herdr plugins dir: ${HERDR_PLUGINS_DIR}`);
  
  const plugins = readdirSync(SOURCE_PLUGINS_DIR);
  for (const plugin of plugins) {
    copyPlugin(plugin);
  }
  
  console.log("[copy-plugins] Done!");
}

/**
 * The program runs only when the file is the entry point.
 *
 * The script is published in the npm package and is the postinstall hook,
 * so a consumer may import it. An import must not copy files into the
 * home directory of the machine that imported it.
 */
const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  main();
}
