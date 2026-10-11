/**
 * Pi-harness Startup Widget
 *
 * Renders harness status as a widget with native Pi styling.
 * Handles terminal width detection and overflow protection.
 */
/**
 * Default config
 */
const DEFAULT_CONFIG = {
    headingStyle: "mdHeading",
    bodyStyle: "dim",
    indent: "  ",
    defaultWidth: 80,
};
/**
 * Get terminal width
 */
export function getTerminalWidth() {
    // Try stdout columns
    if (typeof process !== "undefined" && process.stdout) {
        const cols = process.stdout.columns;
        if (cols && cols > 0) {
            return cols;
        }
    }
    // Fallback to default
    return DEFAULT_CONFIG.defaultWidth;
}
/**
 * Truncate text to fit within max width
 */
export function truncate(text, maxWidth) {
    if (text.length <= maxWidth) {
        return text;
    }
    // Leave room for "..." suffix
    return text.substring(0, Math.max(0, maxWidth - 3)) + "...";
}
/**
 * Truncate text in the middle (for paths/lists)
 */
export function truncateMiddle(text, maxWidth) {
    if (text.length <= maxWidth) {
        return text;
    }
    const half = Math.floor((maxWidth - 3) / 2);
    return text.substring(0, half) + "..." + text.substring(text.length - half);
}
/**
 * Render a status line with optional icon
 */
function renderStatusLine(label, value, width, indent) {
    const maxValueWidth = width - indent.length - label.length - 2; // ": " separator
    const truncatedValue = truncate(value, maxValueWidth);
    return `${indent}${label}: ${truncatedValue}`;
}
/**
 * Render version/tagline line
 */
function renderVersionLine(tagline, width, indent) {
    const maxTagWidth = width - indent.length - 2;
    return `${indent}${truncate(tagline, maxTagWidth)}`;
}
/**
 * Render commands line with truncation
 */
function renderCommandsLine(commands, width, indent) {
    const prefix = `${indent}Commands: `;
    const maxWidth = width - prefix.length;
    const joined = commands.join(", ");
    return prefix + truncate(joined, maxWidth);
}
/**
 * Render harness status as widget body (string array for setWidget)
 */
export function renderWidgetBody(status, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const width = getTerminalWidth();
    const indent = cfg.indent;
    const lines = [];
    // Version/tagline line
    lines.push(renderVersionLine(status.tagline, width, indent));
    // Runtime status
    lines.push(renderStatusLine("Runtime", status.runtime.status, width, indent));
    // Qdrant status
    if (status.qdrant) {
        lines.push(renderStatusLine("Qdrant", status.qdrant.status, width, indent));
    }
    // Honcho status
    if (status.honcho) {
        const honchoDetail = status.honcho.sessionId
            ? `${status.honcho.status} (${status.honcho.sessionId})`
            : status.honcho.status;
        lines.push(renderStatusLine("Honcho", honchoDetail, width, indent));
    }
    // Telegram status
    if (status.telegram) {
        const tgDetail = status.telegram.botName
            ? `${status.telegram.status}: @${status.telegram.botName}`
            : status.telegram.status;
        lines.push(renderStatusLine("Telegram", tgDetail, width, indent));
    }
    // Skills status
    if (status.skills) {
        const skillDetail = `${status.skills.count} discovered`;
        lines.push(renderStatusLine("Skills", skillDetail, width, indent));
    }
    // Commands line (always last, most likely to overflow)
    if (status.commands && status.commands.length > 0) {
        lines.push(renderCommandsLine(status.commands, width, indent));
    }
    return lines;
}
/**
 * Create initial pending status
 */
export function createInitialStatus() {
    return {
        version: "v1.0.0",
        tagline: "quota management, automation, memory, multi-agent",
        runtime: { status: "initializing..." },
        qdrant: { status: "configuring..." },
        honcho: { status: "initializing..." },
        telegram: { status: "connecting..." },
        skills: { count: 0 },
        commands: [],
    };
}
/**
 * Format status with icons
 */
export function formatStatusWithIcon(status) {
    if (status.includes("✓") || status.includes("ready")) {
        return { status, icon: "✓" };
    }
    if (status.includes("✗") || status.includes("error") || status.includes("failed")) {
        return { status, icon: "✗" };
    }
    if (status.includes("...")) {
        return { status, icon: "..." };
    }
    return { status };
}
//# sourceMappingURL=harness-widget.js.map