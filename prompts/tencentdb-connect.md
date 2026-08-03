---
description: Connect to your own TencentDB-Agent-Memory server
argument-hint: "<action>"
---
# TencentDB-Agent-Memory Connection Setup

## Available Actions

Use `/tencentdb-connect` with one of these actions:

| Action | Description |
|--------|-------------|
| `connect` | Connect to an existing server |
| `deploy` | Deploy a new server |
| `test` | Test current connection |
| `status` | Check server health |

## Connect to Existing Server

Run `/tencentdb-connect connect` and provide:

1. **Server URL** - Your TencentDB server address
   - Example: `https://memory.your-domain.com`
   
2. **Service ID** - Usually `default`

3. **User Key** - Provided by server admin

## Deploy New Server

Run `/tencentdb-connect deploy` for guided VPS deployment.

## Test Connection

Run `/tencentdb-connect test` to verify your setup.
