/**
 * Task Compiler - Command Policy
 *
 * Applies project rules and standing policy to generate
 * permittedCommands and prohibitedCommands per task.
 */
import { PROHIBITED_BY_DEFAULT, } from "./types.js";
/**
 * Apply command policy to each task based on project rules and task type.
 *
 * Rules:
 * - PROHIBITED_BY_DEFAULT commands are always forbidden unless overridden
 * - Project rules can add more permitted/prohibited commands
 * - Task type determines which project commands are relevant
 * - build/migrate/commit require explicit permission
 */
export function applyCommandPolicy(tasks, project) {
    const projectCommands = extractProjectCommands(project);
    return tasks.map((task) => {
        const prohibited = [...PROHIBITED_BY_DEFAULT];
        const permitted = [];
        // Add project-specific prohibited commands
        const ruleProhibited = projectCommands.prohibited;
        for (const cmd of ruleProhibited) {
            if (!prohibited.includes(cmd)) {
                prohibited.push(cmd);
            }
        }
        // Add permitted commands based on task type and project commands
        switch (task.type) {
            case "implementation": {
                // Implementers can run any non-prohibited project command
                for (const cmd of projectCommands.permitted) {
                    if (!prohibited.some((p) => cmd.startsWith(p) || p.startsWith(cmd))) {
                        permitted.push(cmd);
                    }
                }
                // Allow test commands for implementation
                permitted.push("bun test", "npm test", "pnpm test", "yarn test");
                permitted.push("python -m pytest");
                break;
            }
            case "test": {
                // Test tasks can run test commands
                for (const cmd of projectCommands.test) {
                    if (!prohibited.includes(cmd)) {
                        permitted.push(cmd);
                    }
                }
                permitted.push("bun test", "npm test", "pnpm test", "yarn test");
                permitted.push("python -m pytest", "python -m unittest");
                break;
            }
            case "e2e_test": {
                // E2E tasks can run e2e/playwright commands
                for (const cmd of projectCommands.e2e) {
                    if (!prohibited.includes(cmd)) {
                        permitted.push(cmd);
                    }
                }
                permitted.push("npx playwright test");
                permitted.push("cypress run");
                break;
            }
            case "review": {
                // Review tasks can run lint/typecheck commands
                for (const cmd of projectCommands.lint) {
                    if (!prohibited.includes(cmd)) {
                        permitted.push(cmd);
                    }
                }
                permitted.push("npx tsc --noEmit");
                permitted.push("npx eslint");
                permitted.push("npx biome check");
                break;
            }
            case "repair": {
                // Repair tasks can run build/test but NOT commit
                for (const cmd of projectCommands.permitted) {
                    if (!prohibited.some((p) => cmd.startsWith(p))) {
                        permitted.push(cmd);
                    }
                }
                permitted.push("bun test", "npm test");
                // Explicitly keep destructive ops away from repair without approval
                prohibited.push("rm -rf", "DROP DATABASE", "TRUNCATE");
                break;
            }
            case "analysis":
            case "design":
            case "documentation": {
                // Read-only/analysis tasks get minimal command access
                permitted.push("npx tsc --noEmit");
                permitted.push("git status");
                permitted.push("git diff");
                break;
            }
        }
        // Explicitly prohibit dangerous commands that must always be blocked
        const alwaysProhibited = [
            "rm -rf /**",
            "DROP DATABASE",
            "TRUNCATE TABLE",
            "bench migrate --force",
        ];
        for (const cmd of alwaysProhibited) {
            if (!prohibited.includes(cmd)) {
                prohibited.push(cmd);
            }
        }
        return {
            ...task,
            permittedCommands: [...new Set(permitted)],
            prohibitedCommands: [...new Set(prohibited)],
        };
    });
}
function extractProjectCommands(project) {
    const result = {
        permitted: [],
        prohibited: [],
        test: [],
        e2e: [],
        lint: [],
    };
    // Extract from project commands
    if (project.commands) {
        for (const [name, cmd] of Object.entries(project.commands)) {
            if (typeof cmd !== "string")
                continue;
            const fullCmd = cmd.trim();
            if (/^test|^spec/i.test(name)) {
                result.test.push(fullCmd);
            }
            else if (/^lint|^check|^type/i.test(name)) {
                result.lint.push(fullCmd);
            }
            else {
                result.permitted.push(fullCmd);
            }
        }
    }
    // Extract from project rules
    if (project.rules) {
        for (const rule of project.rules) {
            if (rule.permittedCommands) {
                for (const cmd of rule.permittedCommands) {
                    if (!result.permitted.includes(cmd)) {
                        result.permitted.push(cmd);
                    }
                }
            }
            if (rule.prohibitedCommands) {
                for (const cmd of rule.prohibitedCommands) {
                    if (!result.prohibited.includes(cmd)) {
                        result.prohibited.push(cmd);
                    }
                }
            }
        }
    }
    return result;
}
//# sourceMappingURL=command-policy.js.map