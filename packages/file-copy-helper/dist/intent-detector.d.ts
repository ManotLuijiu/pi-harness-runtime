/**
 * Intent Detector - Routes user requests to appropriate modules
 *
 * Detects user intent from keywords and activates relevant modules.
 * DEBUG: All events logged to /tmp/intent-detector-debug.log (NOT TUI)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type IntentType = "rea" | "file_copy" | "code_review" | "security" | "general";
export interface IntentResult {
    type: IntentType;
    confidence: number;
    keywords: string[];
    module: string;
    guidance?: string;
}
/**
 * Register the intent detector extension
 */
export declare function registerIntentDetector(pi: ExtensionAPI): void;
export default function intentDetectorExtension(pi: ExtensionAPI): void;
//# sourceMappingURL=intent-detector.d.ts.map