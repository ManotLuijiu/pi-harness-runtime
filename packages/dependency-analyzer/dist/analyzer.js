/**
 * Dependency Analyzer — Main Analyzer
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseImports } from "./imports.js";
function detectCycle(graph) {
    const cycles = [];
    const visited = new Set();
    const stack = [];
    function dfs(nodeId) {
        if (stack.includes(nodeId)) {
            const cycleStart = stack.indexOf(nodeId);
            const cycle = stack.slice(cycleStart);
            if (cycle.length > 1)
                cycles.push([...cycle, nodeId]);
            return;
        }
        if (visited.has(nodeId))
            return;
        visited.add(nodeId);
        stack.push(nodeId);
        const node = graph.nodes.get(nodeId);
        if (node) {
            for (const imp of node.imports) {
                const target = graph.nodes.get(imp);
                if (target)
                    dfs(imp);
            }
        }
        stack.pop();
    }
    for (const id of graph.nodes.keys()) {
        if (!visited.has(id))
            dfs(id);
    }
    return cycles;
}
export class DependencyAnalyzer {
    rootPath;
    maxDepth;
    excludePatterns;
    constructor(rootPath) {
        this.rootPath = rootPath;
        this.maxDepth = 10;
        this.excludePatterns = ["node_modules", "dist", ".git", "coverage", "__pycache__"];
    }
    async analyze(entryFile) {
        const nodes = new Map();
        const edges = [];
        const visited = new Set();
        const queue = [{ file: entryFile, depth: 0 }];
        while (queue.length > 0) {
            const { file, depth } = queue.shift();
            if (depth > this.maxDepth)
                continue;
            if (visited.has(file))
                continue;
            for (const pat of this.excludePatterns) {
                if (file.includes(pat)) {
                    visited.add(file);
                }
            }
            if (!existsSync(file))
                continue;
            visited.add(file);
            let content;
            try {
                content = readFileSync(file, "utf8");
            }
            catch {
                continue;
            }
            const imports = parseImports(content, file);
            const relativePath = relative(this.rootPath, file);
            const node = {
                id: relativePath,
                filePath: file,
                kind: "import",
                imports: imports.filter((imp) => !imp.startsWith(".") || existsSync(join(this.rootPath, imp))),
            };
            nodes.set(relativePath, node);
            for (const imp of node.imports) {
                const targetFile = join(this.rootPath, imp);
                if (existsSync(targetFile)) {
                    const targetRelative = relative(this.rootPath, targetFile);
                    if (!nodes.has(targetRelative)) {
                        queue.push({ file: targetFile, depth: depth + 1 });
                    }
                    edges.push({ from: relativePath, to: targetRelative, kind: "import", weight: 1 });
                }
            }
        }
        const graph = { nodes, edges, cycles: [] };
        graph.cycles = detectCycle(graph);
        return graph;
    }
    getStats(graph) {
        return {
            totalFiles: graph.nodes.size,
            totalImports: graph.edges.length,
            cycles: graph.cycles.length,
        };
    }
}
//# sourceMappingURL=analyzer.js.map