/**
 * Knowledge Graph - RFC-0106
 *
 * Extract nodes and edges from SKILL.md files.
 */
function parseSKILL(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = { content: '' };
    let inFrontmatter = false;
    for (const line of lines) {
        if (line.trim() === '---') {
            inFrontmatter = !inFrontmatter;
            continue;
        }
        if (inFrontmatter)
            continue;
        if (line.startsWith('## ')) {
            if (currentSection.content) {
                sections.push(currentSection);
            }
            currentSection = { title: line.slice(3), content: '' };
        }
        else {
            currentSection.content += (currentSection.content ? '\n' : '') + line;
        }
    }
    if (currentSection.content) {
        sections.push(currentSection);
    }
    const titleMatch = content.match(/^#\s+(.+)$/m);
    return { title: titleMatch?.[1], sections };
}
/**
 * Extract RFC references from content
 */
function extractRFCRefs(content) {
    const rfcPattern = /RFC[- ]?(\d{4})/gi;
    const matches = content.match(rfcPattern) || [];
    return [...new Set(matches.map(m => {
            const num = m.replace(/[^0-9]/g, '');
            return `RFC-${num.padStart(4, '0')}`;
        }))];
}
/**
 * Extract wiki links from content (e.g., [[skill:xxx]])
 */
function extractWikiLinks(content) {
    const linkPattern = /\[\[([^\]]+)\]\]/g;
    const matches = content.match(linkPattern) || [];
    return matches.map(m => m.slice(2, -2).trim());
}
/**
 * Extract skill ID from file path
 */
function extractSkillId(filePath) {
    // Path: .../skills/{skill-id}/SKILL.md
    const match = filePath.match(/skills\/([^/]+)\/SKILL\.md$/i);
    return match ? match[1] : filePath.split('/').pop()?.replace('.md', '') || 'unknown';
}
/**
 * Parse provenance from frontmatter
 */
function parseProvenance(frontmatter) {
    return {
        implements: frontmatter.provenance || undefined,
        related_implementation: frontmatter.related_implementation || undefined,
        author: frontmatter.author || undefined,
        version: frontmatter.version || undefined,
    };
}
/**
 * Extract a knowledge node from a SKILL.md file
 */
export function extractSkillNode(filePath, content, frontmatter) {
    const skillId = extractSkillId(filePath);
    const provenance = parseProvenance(frontmatter);
    const okf = parseSKILL(content);
    return {
        id: `skill:${skillId}`,
        type: 'skill',
        data: {
            title: frontmatter.title || okf.title || skillId,
            description: okf.sections[0]?.content.slice(0, 200) || undefined,
            tags: frontmatter.tags || [],
            source: filePath,
        },
    };
}
/**
 * Extract edges from a SKILL.md file
 */
export function extractSkillEdges(filePath, content, frontmatter) {
    const skillId = extractSkillId(filePath);
    const provenance = parseProvenance(frontmatter);
    const edges = [];
    // Provenance: implements RFC
    if (provenance.implements) {
        const rfcNum = provenance.implements.replace(/RFC[- ]?/i, '').padStart(4, '0');
        edges.push({
            from: `skill:${skillId}`,
            to: `rfc:RFC-${rfcNum}`,
            type: 'implements',
            metadata: { source: 'frontmatter:provenance.implements' },
        });
    }
    // Provenance: documents implementation
    if (provenance.related_implementation) {
        edges.push({
            from: `skill:${skillId}`,
            to: `implementation:${provenance.related_implementation}`,
            type: 'documents',
            metadata: { source: 'frontmatter:related_implementation' },
        });
    }
    // Content: RFC references
    const rfcRefs = extractRFCRefs(content);
    for (const rfc of rfcRefs) {
        if (rfc !== provenance.implements) { // Don't duplicate
            edges.push({
                from: `skill:${skillId}`,
                to: rfc,
                type: 'references',
                metadata: { source: 'content:regex' },
            });
        }
    }
    // Content: wiki links
    const wikiLinks = extractWikiLinks(content);
    for (const link of wikiLinks) {
        if (link.startsWith('skill:')) {
            edges.push({
                from: `skill:${skillId}`,
                to: link,
                type: 'related_to',
                metadata: { source: 'content:wiki-link' },
            });
        }
    }
    return edges;
}
/**
 * Extract RFC nodes from RFC markdown files
 */
export function extractRFCNode(filePath, content, title) {
    // Extract RFC number from filename: RFC-0106_KNOWLEDGE_GRAPH_PROVENANCE.md
    const match = filePath.match(/RFC[- ]?(\d{4})/i);
    const rfcNum = match ? match[1].padStart(4, '0') : '0000';
    // Extract summary from first paragraph
    const summaryMatch = content.match(/## Summary\n+([^\n]+)/i);
    const summary = summaryMatch ? summaryMatch[1].slice(0, 200) : undefined;
    // Extract tags from content
    const tagMatches = content.match(/tag[s]?:?\s*\[([^\]]+)\]/i);
    const tags = tagMatches
        ? tagMatches[1].split(',').map(t => t.trim().toLowerCase())
        : [];
    return {
        id: `rfc:RFC-${rfcNum}`,
        type: 'rfc',
        data: {
            title,
            description: summary,
            tags,
            source: filePath,
            url: `https://github.com/ManotLuijiu/pi-harness-runtime/blob/main/${filePath}`,
        },
    };
}
/**
 * Extract edges between RFCs
 */
export function extractRFCEdges(filePath, content) {
    const edges = [];
    // RFC references other RFCs
    const rfcRefs = extractRFCRefs(content);
    const match = filePath.match(/RFC[- ]?(\d{4})/i);
    const rfcNum = match ? `RFC-${match[1].padStart(4, '0')}` : 'rfc:unknown';
    for (const ref of rfcRefs) {
        edges.push({
            from: rfcNum,
            to: ref,
            type: 'references',
            metadata: { source: 'content:regex' },
        });
    }
    // Supersedes (e.g., "Supersedes RFC-0008")
    const supersedesMatch = content.match(/supersedes\s+RFC[- ]?(\d{4})/gi);
    if (supersedesMatch) {
        for (const match of supersedesMatch) {
            const numMatch = match.match(/\d{4}/);
            if (numMatch) {
                const superseded = `RFC-${numMatch[0].padStart(4, '0')}`;
                edges.push({
                    from: rfcNum,
                    to: superseded,
                    type: 'supersedes',
                    metadata: { source: 'content:supersedes' },
                });
            }
        }
    }
    return edges;
}
/**
 * Build complete knowledge graph from directory
 */
export async function extractKnowledgeGraph(skillsPath, rfcPath) {
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const nodes = [];
    const edges = [];
    // Extract skill nodes and edges
    try {
        const skillDirs = await readdir(skillsPath, { withFileTypes: true });
        for (const dir of skillDirs) {
            if (!dir.isDirectory())
                continue;
            const skillPath = join(skillsPath, dir.name, 'SKILL.md');
            try {
                const content = await readFile(skillPath, 'utf-8');
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                const frontmatter = {};
                if (frontmatterMatch) {
                    for (const line of frontmatterMatch[1].split('\n')) {
                        const [key, ...valueParts] = line.split(':');
                        if (key && valueParts.length) {
                            const value = valueParts.join(':').trim();
                            // Handle arrays
                            if (value.startsWith('[')) {
                                frontmatter[key.trim()] = value
                                    .slice(1, -1)
                                    .split(',')
                                    .map(v => v.trim().replace(/['"]/g, ''));
                            }
                            else {
                                frontmatter[key.trim()] = value.replace(/['"]/g, '');
                            }
                        }
                    }
                }
                const node = extractSkillNode(skillPath, content, frontmatter);
                nodes.push(node);
                const skillEdges = extractSkillEdges(skillPath, content, frontmatter);
                edges.push(...skillEdges);
            }
            catch {
                // Skip files that can't be read
            }
        }
    }
    catch {
        // Skills directory might not exist
    }
    // Extract RFC nodes and edges
    try {
        const rfcFiles = await readdir(rfcPath);
        for (const file of rfcFiles) {
            if (!file.match(/^RFC[- ]?\d{4}_.*\.md$/i))
                continue;
            const filePath = join(rfcPath, file);
            const content = await readFile(filePath, 'utf-8');
            // Extract title from first # heading
            const titleMatch = content.match(/^#\s+(.+)$/m);
            const title = titleMatch ? titleMatch[1].replace(/^RFC[-\d]+\s*[-–]\s*/, '') : file;
            const node = extractRFCNode(filePath, content, title);
            nodes.push(node);
            const rfcEdges = extractRFCEdges(filePath, content);
            edges.push(...rfcEdges);
        }
    }
    catch {
        // RFC directory might not exist
    }
    return { nodes, edges };
}
//# sourceMappingURL=graph-extractor.js.map