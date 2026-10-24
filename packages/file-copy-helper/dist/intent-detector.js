/**
 * Intent Detector - Routes user requests to appropriate modules
 *
 * Detects user intent from keywords and activates relevant modules.
 * DEBUG: All events logged to /tmp/intent-detector-debug.log (NOT TUI)
 */
import * as fs from "fs";
// Debug log file
const DEBUG_LOG = "/tmp/intent-detector-debug.log";
function debugLog(label, data) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${label}] ${data ? JSON.stringify(data, null, 2) : ""}\n`;
    try {
        fs.appendFileSync(DEBUG_LOG, entry);
    }
    catch {
        // Silently fail
    }
}
// REA Keywords - Reverse Engineering / App Analysis
const REA_KEYWORDS = [
    // English
    "reverse engineer",
    "reverse engineering",
    "rea",
    "analyze binary",
    "decompile",
    "disassemble",
    "inspect binary",
    "understand how",
    "replicate app",
    "clone app",
    "copy app",
    "mimic app",
    // Chinese (简体中文)
    "逆向",
    "逆向工程",
    "反编译",
    "分析二进制",
    "克隆应用",
    "复制应用",
    "理解如何运作",
    // Thai (ภาษาไทย)
    "วิเคราะห์ย้อนกลับ",
    "ย้อนวิศวกรรม",
    "แกะโค้ด",
    "ถอดรหัส",
    "เข้าใจการทำงาน",
    "คัดลอกแอป",
    "โคลนแอป",
    "ทำซ้ำแอป",
    // Common patterns
    "see a feature",
    "understand.*binary",
];
// File Copy Keywords
const FILE_COPY_KEYWORDS = [
    // English
    "mimic",
    "clone",
    "replicate",
    "copy file",
    "copy folder",
    "copy from",
    "migrate",
    "deploy",
    "sync to",
    // Chinese
    "克隆",
    "复制",
    "迁移",
    // Thai
    "คัดลอก",
    "โคลน",
    "ทำซ้ำ",
    "ย้าย",
    // Code patterns
    "cp -r",
    "sudo cp",
];
// Code Review Keywords
const CODE_REVIEW_KEYWORDS = [
    "review code",
    "review this",
    "audit",
    "check for bugs",
    "security audit",
    "find vulnerabilities",
];
// Security Keywords
const SECURITY_KEYWORDS = [
    "security",
    "vulnerability",
    "exploit",
    "attack",
    "pentest",
    "penetration test",
];
/**
 * Detect user intent from text using keyword matching
 */
function keywordDetect(text) {
    const lower = text.toLowerCase();
    const matchedKeywords = [];
    // Check REA keywords (highest priority for reverse engineering)
    for (const keyword of REA_KEYWORDS) {
        if (keyword.startsWith("^")) {
            if (new RegExp(keyword, "i").test(text)) {
                matchedKeywords.push(keyword);
            }
        }
        else if (lower.includes(keyword.toLowerCase())) {
            matchedKeywords.push(keyword);
        }
    }
    if (matchedKeywords.length > 0) {
        return { type: "rea", keywords: matchedKeywords };
    }
    // Check File Copy keywords
    matchedKeywords.length = 0;
    for (const keyword of FILE_COPY_KEYWORDS) {
        if (lower.includes(keyword.toLowerCase())) {
            matchedKeywords.push(keyword);
        }
    }
    if (matchedKeywords.length > 0) {
        return { type: "file_copy", keywords: matchedKeywords };
    }
    // Check Code Review keywords
    matchedKeywords.length = 0;
    for (const keyword of CODE_REVIEW_KEYWORDS) {
        if (lower.includes(keyword.toLowerCase())) {
            matchedKeywords.push(keyword);
        }
    }
    if (matchedKeywords.length > 0) {
        return { type: "code_review", keywords: matchedKeywords };
    }
    // Check Security keywords
    matchedKeywords.length = 0;
    for (const keyword of SECURITY_KEYWORDS) {
        if (lower.includes(keyword.toLowerCase())) {
            matchedKeywords.push(keyword);
        }
    }
    if (matchedKeywords.length > 0) {
        return { type: "security", keywords: matchedKeywords };
    }
    return { type: "general", keywords: [] };
}
/**
 * Jev-based intent classifier for ambiguous cases
 */
async function jevClassify(_text, baseIntent, keywords) {
    // For clear cases (high keyword count), skip Jev
    if (keywords.length >= 2) {
        return {
            confirmed: true,
            confidence: Math.min(1, keywords.length * 0.3),
            reasoning: `Strong keyword match: ${keywords.join(", ")}`,
        };
    }
    // For ambiguous cases, use Jev judgment
    if (baseIntent === "rea") {
        return {
            confirmed: keywords.length >= 1,
            confidence: 0.5,
            reasoning: "Single REA keyword detected - confirming with context",
        };
    }
    if (baseIntent === "file_copy") {
        return {
            confirmed: keywords.length >= 1,
            confidence: 0.5,
            reasoning: "Single file copy keyword detected - confirming with context",
        };
    }
    return {
        confirmed: false,
        confidence: 0,
        reasoning: "No clear intent detected",
    };
}
/**
 * Detect user intent from text
 */
async function detectIntent(text) {
    // Step 1: Keyword-based detection
    const { type, keywords } = keywordDetect(text);
    // Step 2: Jev-based confirmation for ambiguous cases
    const jevResult = await jevClassify(text, type, keywords);
    if (!jevResult.confirmed) {
        return {
            type: "general",
            confidence: 0,
            keywords: [],
            module: "default",
        };
    }
    // Step 3: Build result based on confirmed intent
    const confidence = jevResult.confidence || Math.min(1, keywords.length * 0.3);
    if (type === "rea") {
        return {
            type: "rea",
            confidence,
            keywords,
            module: "@pi-harness/rea",
            guidance: "REA: Use Hopper/Ghidra/IDA for binary analysis. Check https://github.com/morluto/rea",
        };
    }
    if (type === "file_copy") {
        return {
            type: "file_copy",
            confidence,
            keywords,
            module: "@pi-harness/file-copy-helper",
            guidance: "COPY: Use sudo cp instead of reading files first",
        };
    }
    if (type === "code_review") {
        return {
            type: "code_review",
            confidence,
            keywords,
            module: "@pi-harness/code-review",
        };
    }
    if (type === "security") {
        return {
            type: "security",
            confidence,
            keywords,
            module: "@pi-harness/security-auditor",
        };
    }
    return {
        type: "general",
        confidence: 0,
        keywords: [],
        module: "default",
    };
}
/**
 * Get REA knowledge base reference
 */
function getREAKnowledge() {
    return `
## REA Integration - Reverse Engineering

When user requests reverse engineering or app analysis:

1. **Check REA capabilities**: https://github.com/morluto/rea

2. **Analysis Providers Available**:
   - Hopper Disassembler (macOS native)
   - Ghidra (cross-platform)
   - IDA Pro (commercial)
   - Pwntools (ELF/binary analysis)
   - Browser CDP (web app inspection)
   - Android APK (JADX decompilation)

3. **Key REA Workflow**:
   - Setup REA MCP server with agent
   - Agent asks "analyze this binary"
   - REA routes to appropriate provider
   - Evidence recorded to InvestigationRecords
   - Agent summarizes findings

4. **No binary?** Use browser inspection:
   - CDP for web apps
   - Source maps for JS
   - AST analysis for bundles
`;
}
/**
 * Get file copy guidance
 */
function getFileCopyGuidance() {
    return `
## File Copy - Use sudo cp

When user asks to mimic/clone/copy files:

1. **DO NOT read source files** - just copy directly
2. **Use sudo cp** - preserves permissions
3. **Copy recursively** with -r for folders

Examples:
\`\`\`bash
sudo cp /source/file.ts /dest/file.ts
sudo cp -r /source/folder/ /dest/folder/
\`\`\`

**STOP**: No read/cat/expand needed. Copy preserves everything.
`;
}
/**
 * Register the intent detector extension
 */
export function registerIntentDetector(pi) {
    // Clear debug log on startup
    fs.writeFileSync(DEBUG_LOG, `[${new Date().toISOString()}] === INTENT DETECTOR STARTED ===\n`);
    debugLog("INIT", "Intent detector registered");
    // Listen to input events
    pi.on("input", async (event) => {
        // Only process user input
        if (event.source !== "interactive") {
            return;
        }
        const text = event.text.trim();
        if (!text || text.length < 5) {
            return;
        }
        // Detect intent with Jev classification
        const intent = await detectIntent(text);
        debugLog("DETECTED", intent);
        // If high confidence, inject guidance
        if (intent.confidence >= 0.5 && intent.type !== "general") {
            let guidance = "";
            if (intent.type === "rea") {
                guidance = getREAKnowledge();
            }
            else if (intent.type === "file_copy") {
                guidance = getFileCopyGuidance();
            }
            if (guidance) {
                debugLog("INJECT_GUIDANCE", { type: intent.type, confidence: intent.confidence });
                return {
                    action: "transform",
                    text: text + guidance,
                };
            }
        }
        return;
    });
    // Broadcast intent for other modules
    pi.on("input", async (event) => {
        if (event.source !== "interactive")
            return;
        const intent = await detectIntent(event.text);
        debugLog("BROADCAST_INTENT", intent);
    });
}
// Default export
export default function intentDetectorExtension(pi) {
    registerIntentDetector(pi);
}
//# sourceMappingURL=intent-detector.js.map