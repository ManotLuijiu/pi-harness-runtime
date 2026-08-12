/**
 * Copy herdr plugins to runtime directory
 * 
 * Copies herdr plugins from .pi/plugins/ to ~/.config/herdr/plugins/
 * The source .pi/plugins/ is gitignored but included in npm package via files array.
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_PLUGINS_DIR = join(__dirname, "..", ".pi", "plugins");
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
    console.log("[copy-plugins] No .pi/plugins/ directory found, skipping");
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

main();
