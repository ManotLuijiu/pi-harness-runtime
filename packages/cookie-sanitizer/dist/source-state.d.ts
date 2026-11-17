/**
 * The state of the cookie source.
 *
 * Three facts are different and were conflated:
 *
 *  - discovery: a file exists in the drop folder.
 *  - import: the canonical cache exists, which only happens after a
 *    successful validation and normalization of a drop file.
 *  - authentication: the provider accepted the credential.
 *
 * The first two are facts about this machine and are cheap to read. The
 * third is a fact about the provider and only a fetch can establish it.
 * This module reports the first two; the runtime reports the third.
 *
 * Nothing here reads a cookie value: the state is a stage and a count.
 */
/**
 * How far the cookie source got.
 *
 * - `none`: nothing was found.
 * - `discovered`: a file was found in the drop folder; it was not imported.
 * - `imported`: the canonical cache exists, so an import succeeded.
 */
export type CookieSourceStage = "none" | "discovered" | "imported";
/** The state of the cookie source. */
export interface CookieSourceState {
    /** The stage the source reached. */
    stage: CookieSourceStage;
    /** The files that the drop folder holds. */
    dropFileCount: number;
    /** Whether the canonical cache exists. */
    cacheExists: boolean;
    /** The canonical cache path, when it is known. */
    cachePath: string | null;
}
/** The options of the inspection. */
export interface InspectCookieSourceOptions {
    /** The drop folder. */
    dropDir: string;
    /** The canonical cache path. */
    cachePath?: string;
}
/**
 * Report the state of the cookie source.
 *
 * Never throws: an unreadable folder is a folder with no files.
 */
export declare function inspectCookieSource(options: InspectCookieSourceOptions): CookieSourceState;
/**
 * Whether a source exists at all.
 *
 * The name says "exists", so it answers the discovery question and never
 * the authentication question.
 */
export declare function hasCookieSourceState(state: CookieSourceState): boolean;
//# sourceMappingURL=source-state.d.ts.map