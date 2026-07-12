/**
 * Task Compiler - Command Policy
 *
 * Applies project rules and standing policy to generate
 * permittedCommands and prohibitedCommands per task.
 */
import { type CompiledTask, type ProjectProfile } from "./types.js";
/**
 * Apply command policy to each task based on project rules and task type.
 *
 * Rules:
 * - PROHIBITED_BY_DEFAULT commands are always forbidden unless overridden
 * - Project rules can add more permitted/prohibited commands
 * - Task type determines which project commands are relevant
 * - build/migrate/commit require explicit permission
 */
export declare function applyCommandPolicy(tasks: CompiledTask[], project: ProjectProfile): CompiledTask[];
//# sourceMappingURL=command-policy.d.ts.map