# Suggested Files — RFC-0101

```text
packages/
├── autonomous-runtime/
│   ├── src/
│   │   ├── inbox.ts
│   │   ├── lease.ts
│   │   ├── recovery.ts
│   │   ├── worker.ts
│   │   ├── supervisor.ts          # unit installation (systemd/launchd/cron)
│   │   └── types.ts
│   ├── scripts/
│   │   └── reap-leases.ts         # standalone reaper for cron / external trigger
│   ├── units/                     # supervisor drop-ins
│   │   ├── systemd/
│   │   │   ├── pi-runtime.service
│   │   │   └── pi-runtime.timer.example
│   │   ├── launchd/
│   │   │   └── ai.moocoding.runtime.plist
│   │   └── cron/
│   │       └── pi-runtime.cron.example
│   ├── test/
│   │   ├── inbox.test.ts
│   │   ├── lease.test.ts
│   │   ├── worker.test.ts
│   │   └── recovery.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── privilege-broker/
│   ├── src/
│   │   ├── registry.ts            # loads config/privileges.yaml
│   │   ├── executor.ts            # execve wrapper
│   │   └── audit.ts               # append-only audit log writer
│   ├── config/
│   │   └── privileges.yaml        # versioned, reviewed capability registry
│   ├── logrotate.d/
│   │   └── pi-runtime-audit       # daily rotation
│   ├── test/
│   │   ├── registry.test.ts
│   │   ├── executor.test.ts
│   │   └── audit.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── scheduler-adapter/
│   ├── src/
│   │   ├── interface.ts           # SchedulerAdapter contract
│   │   ├── systemd.ts             # compiles ScheduledTask to .service/.timer
│   │   ├── launchd.ts             # compiles to .plist
│   │   ├── cron.ts                # writes crontab fragments
│   │   └── internal.ts            # in-process timer (dev/test only)
│   ├── test/
│   │   ├── systemd.test.ts
│   │   ├── launchd.test.ts
│   │   ├── cron.test.ts
│   │   └── internal.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── okf-kb/                        # OKF lesson / pattern promotion (extends existing)
│   └── (existing — append promote-pattern.ts + promote-lesson.ts)
│
└── config/
    └── privileges.yaml            # initial capability registry
```

## Files Modified (out-of-tree)

```text
skills/harness-runtime/SKILL.md    # add /runtime command, link RFC-0101
README.md                          # reference RFC-0101 + new packages
MANIFEST.json                      # include autonomous-runtime, privilege-broker, scheduler-adapter
```

## Files NOT Modified

- RFC-0001, RFC-0003, RFC-0006, RFC-0011, RFC-0015, RFC-0017, RFC-0018, RFC-0022, RFC-0028 — referenced as integration points only.
