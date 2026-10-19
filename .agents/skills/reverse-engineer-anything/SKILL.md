---
name: reverse-engineer-anything
description: Reverse engineer native, managed, Electron/JavaScript, packaged, firmware, and browser targets with REA. Use shipped-artifact or requested runtime evidence to explain features, compare versions, decompile code, or guide a reconstruction. Skip REA for ordinary source-repository architecture analysis.
metadata:
  version: "42"
---

# REA - Reverse Engineer Anything

Use REA when a claim depends on a shipped binary or package, decompilation,
passive application runtime evidence, or comparison with
behavior not established by available source. For ordinary analysis of a
complete source repository, use normal repository tools and do not run REA
readiness or provider commands.

## Connect only when needed

Installing this skill supplies instructions; it does not register the REA MCP
server, install analysis engines, or add tools to an already-running agent.

If REA tools are available and their registration is not known to be stale,
proceed directly to the target. Do not run diagnostics or setup before every
investigation. Use the connected server's actual tool list and input schemas.

If tools are absent, a call is blocked by the client, or a required provider is
unavailable:

1. Diagnose without changing REA or client configuration

   ```bash
   npx -y rea-agents@latest doctor --client codex --json
   ```

   Substitute the current supported client: `claude_code`, `claude_desktop`, `codex`, `cursor`,
   `gemini_cli`, `windsurf`, `devin`, `opencode`, `antigravity`, `copilot_cli`,
   `commandcode`, `vscode`, `grok_build`, `omp`, or `grok_bot`.

2. Distinguish the reason:

   - Missing, malformed, or stale registration needs scoped configuration repair
   - Aligned registration with no tools needs restart/reconnection
   - Missing provider affects only tasks requiring that provider

3. For configuration repair:

   ```bash
   # Read-only plan first
   npx -y rea-agents@latest setup --client codex --dry-run --json

   # Apply after approval
   npx -y rea-agents@latest setup --client codex --yes
   ```

4. Restart/reconnect the agent and verify REA tools appear

**Note**: REA setup never installs or upgrades Node.js, npm, Homebrew, Java, Ghidra, IDA,
JADX, Kuna, Binwalk, or Unblob. Use existing prerequisites.

## Route the Target First

Choose the first tool from the target the user supplied:

| Target Type | First Tool |
|-------------|------------|
| ASAR or extracted JavaScript/Electron | `analyze_javascript_application` |
| Archive/package (ZIP/APK/IPA/MSIX) | `open_binary` |
| Android APK | `inspect_android_package` |
| Managed PE/CLI assembly | `inspect_managed_artifact` |
| Firmware image | `inspect_firmware_regions` |
| Browser page | `list_browser_targets` |
| Browser action | `capture_browser_scenario` |
| Fiddler traffic | `inspect_web_network_capture` |
| Electron runtime | `list_electron_targets` |
| Packet capture | `inspect_packet_capture` |
| WebAssembly | `inspect_wasm_artifact` |
| EVM bytecode | `inspect_evm_interface` |
| Go binary | `inspect_go_binary` |
| Rust binary | `inspect_rust_binary` |
| SQLite database | `inspect_sqlite_database` |
| Linux ELF | `inspect_binary_layout` |
| Native executable | `open_binary` |
| IDA database | `open_binary` with `provider_id: "ida"` |
| Kuna session | `open_binary` with `provider_id: "kuna"` |

## Work Summary-First

Start with the default result and use its inline Evidence and graph context:

```javascript
// For JavaScript application or ELF layout
analyze_javascript_application({ target: "/path/to/app", detail: "summary" })
// or
inspect_binary_layout({ target: "/path/to/binary", detail: "summary" })
```

Then inspect with `inspect_analysis_view` using the returned `parent_evidence_id`.

## Plan Broader Investigations

For requests spanning multiple features or subsystems:

1. Turn the request into a checklist of questions and the evidence each needs
2. Inspect current REA session, artifact identity, saved analysis database
3. Start with the smallest useful overview or inventory
4. Inspect relevant packaged resources alongside code
5. Corroborate conclusions with the evidence type it requires
6. Decompose work into independent questions
7. Keep a concise finding ledger linking conclusions to Evidence IDs

## Finish the Task

Explain findings in plain language and tie them to returned evidence.
When the user asks to build something, use normal coding tools.
Close an opened native session with `close_binary` when investigation is complete.

## Available Guides

See `references/` directory for detailed workflows:

- `native-and-artifacts.md` - Native binaries, managed assemblies, archives
- `javascript-applications.md` - ASARs, extracted JS, feature tracing
- `android-applications.md` - APK analysis
- `runtime-observation.md` - Browser/Electron observation
- `evidence-workflows.md` - Evidence paging, comparisons, verification
