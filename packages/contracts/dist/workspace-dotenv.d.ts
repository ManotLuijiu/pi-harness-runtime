/**
 * Reading the dotenv files of a workspace.
 *
 * This module owns the file system part of the environment detection: it
 * finds the ".env" files of a workspace, reads them and skips what must not
 * be read (templates, huge files, unreadable files).
 *
 * It is deliberately free of any other dependency (no node:sqlite) so it
 * can be unit tested everywhere: the detection module itself needs
 * node:sqlite, which not every runtime provides.
 */
/**
 * The biggest dotenv file that is read. A ".env" file is a few kilobytes;
 * anything bigger is not a configuration file (and reading it on every
 * session start would be a waste).
 */
export declare const DOTENV_MAX_BYTES: number;
/**
 * True for a template file that only documents the variables
 * (".env.example", ".env.sample", ".env.template", ...).
 *
 * A template is not the configuration of the workspace: it must never
 * decide the mode. The marker is looked for in EVERY segment of the
 * suffix, so ".env.example.local" is a template too.
 */
export declare function isTemplateDotenvName(name: string): boolean;
/**
 * The dotenv files of a workspace as FULL paths, in the order they are read.
 *
 * ".env" comes first, then the well known variants, then every other
 * ".env.*" file. Template files are skipped.
 */
export declare function listDotenvFiles(workspacePath: string): string[];
/**
 * Read the dotenv files of a workspace.
 *
 * The files are read through the full paths of listDotenvFiles, so the
 * workspace - not the current working directory - decides which files are
 * read.
 */
export declare function readDotenvFiles(workspacePath: string): {
    name: string;
    content: string;
}[];
