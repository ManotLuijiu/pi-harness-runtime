/**
 * The canonical workspace of a process.
 *
 * The routing of a plan handoff starts with the workspace of the sender: the
 * directory the sender actually runs in, not a path copied from an old
 * prompt. Two spellings of the same directory are the same workspace after
 * the canonicalization; two worktrees of one repository are two workspaces,
 * because their paths differ and the rule never collapses them into the
 * repository root.
 */
/**
 * The workspace of a process, canonical and as it was spelled.
 */
export interface CanonicalWorkspace {
    /** The absolute path with every symbolic link resolved. */
    path: string;
    /** The path before the canonicalization, for a diagnostic. */
    raw: string;
}
/**
 * Expand a leading `~` to the home directory.
 *
 * `~` and `~/...` are the home directory; `~user` is not expanded, because
 * the store of the users of a machine is not the business of the router.
 */
export declare function expandHome(path: string): string;
/**
 * The canonical form of a path: absolute, with every symbolic link resolved.
 *
 * A path that does not exist cannot be resolved; the absolute form is the
 * answer then. The comparison of two workspaces never fails because of a
 * missing directory.
 */
export declare function canonicalizePath(path: string): string;
/**
 * The workspace of the current process.
 *
 * The working directory is the source: `process.cwd()` resolves the
 * symbolic links of the current directory already on most systems, and the
 * filesystem is asked for the truth when it can be asked.
 */
export declare function detectWorkspace(cwd?: string): CanonicalWorkspace;
/**
 * Whether two paths name the same workspace.
 *
 * The comparison is on the canonical form, so a symlink and its target are
 * the same workspace. Two worktrees of one repository have different
 * canonical paths and are therefore different workspaces.
 */
export declare function sameWorkspace(left: string, right: string): boolean;
/**
 * Whether a path lies inside a workspace.
 *
 * The comparison is on the canonical form. A path that does not exist yet
 * is compared in its absolute form, so a reference to a file that is about
 * to be created still counts as inside.
 */
export declare function isInsideWorkspace(path: string, workspace: string): boolean;
//# sourceMappingURL=workspace.d.ts.map