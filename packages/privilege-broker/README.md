# Privilege Broker — RFC-0101 §7

Safe privilege escalation for autonomous tasks.

## Package

`@pi-harness/privilege-broker`

## Capabilities

| Capability | Description | Auto-approve? |
|---|---|---|
| `read_files` | Read any file | Yes |
| `write_files` | Write to non-system paths | No |
| `run_command` | Execute shell commands | No |
| `sudo_command` | Execute with sudo | No |
| `network_request` | HTTP/HTTPS requests | Yes |
| `git_push` | Push to configured remotes | No |
| `package_install` | Install npm packages | No |
| `env_read` | Read environment variables | Yes |

## Usage

```ts
import { PrivilegeBroker, ConsoleAuditLogger } from "@pi-harness/privilege-broker";

const broker = new PrivilegeBroker({
  audit: new ConsoleAuditLogger(),
});

// Check before running a command
const result = await broker.check(
  "run_command",
  { command: "ls /tmp", cwd: "/tmp" },
  async (msg) => confirm(msg),
);

if (result.approved) {
  await broker.execute("run_command", { command: "ls /tmp" });
}
```

## Status

Phase 1 done. Approval classes and conditions implemented.
