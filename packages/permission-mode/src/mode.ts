/**
 * Permission Mode Types
 */

/**
 * Permission mode types - inspired by T3Code
 */
export type PermissionModeType = 
  | 'supervised'      // Requests approval for all commands/edits
  | 'auto-accept-edits' // Approves file edits, questions need approval
  | 'auto'              // Uses automatic review for routine actions
  | 'full-access';      // No approval needed

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
export const DEFAULT_PERMISSION_MODES: Record<PermissionModeType, PermissionMode> = {
  supervised: {
    type: 'supervised',
  },
  'auto-accept-edits': {
    type: 'auto-accept-edits',
    autoAcceptTools: ['write', 'edit', 'create'],
  },
  auto: {
    type: 'auto',
    autoAcceptTools: ['read', 'search', 'list'],
  },
  'full-access': {
    type: 'full-access',
  },
};

/**
 * Get default mode for new sessions
 */
export function getDefaultMode(): PermissionMode {
  return { ...DEFAULT_PERMISSION_MODES['full-access'] };
}

/**
 * Check if mode requires approval for tool
 */
export function requiresApproval(mode: PermissionMode, tool: string): boolean {
  if (mode.blockedTools?.includes(tool)) {
    return true;
  }
  
  switch (mode.type) {
    case 'full-access':
      return false;
    case 'auto-accept-edits':
      return !mode.autoAcceptTools?.includes(tool);
    case 'auto':
      return !mode.autoAcceptTools?.includes(tool);
    case 'supervised':
    default:
      return true;
  }
}
