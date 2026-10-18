/**
 * Permission Mode Types
 */
/**
 * Permission mode types - inspired by T3Code
 */
export type PermissionModeType = 'supervised' | 'auto-accept-edits' | 'auto' | 'full-access';
/**
 * Permission mode configuration
 */
export interface PermissionMode {
    type: PermissionModeType;
    /** Project override for this mode */
    projectOverride?: string;
    /** Auto-accept certain tools without approval */
    autoAcceptTools?: string[];
    /** Block certain tools regardless of mode */
    blockedTools?: string[];
}
/**
 * Default permission modes
 */
export declare const DEFAULT_PERMISSION_MODES: Record<PermissionModeType, PermissionMode>;
/**
 * Get default mode for new sessions
 */
export declare function getDefaultMode(): PermissionMode;
/**
 * Check if mode requires approval for tool
 */
export declare function requiresApproval(mode: PermissionMode, tool: string): boolean;
