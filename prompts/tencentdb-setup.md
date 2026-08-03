---
description: Interactively configure TencentDB-Agent-Memory connection
argument-hint: "<server-url> [service-id] [user-key]"
---
# Setup TencentDB-Agent-Memory Connection

${1:---}

## Configuration Options

**Arguments:**
- `$1` = Server URL (e.g., `https://memory.example.com`)
- `$2` = Service ID (default: `default`)
- `$3` = User Key (from server admin)

## Step-by-Step Setup

### Step 1: Enter Server URL

Please provide your TencentDB-Agent-Memory server URL:

```
https://your-server.com
```

### Step 2: Enter Service ID

Enter your service ID (or press Enter for `default`):

```
default
```

### Step 3: Enter User Key

Enter your user key:

```
your-user-key-here
```

## Configuration Methods

### Option A: Environment File (.env)

Create or update `.env` in your project:

```bash
TENANTDB_URL=${1:-https://your-server.com}
TENANTDB_SERVICE_ID=${2:-default}
TENANTDB_USER_KEY=${3}
```

### Option B: Settings JSON

Add to `.pi/settings.json`:

```json
{
  "tencentdb": {
    "url": "${1:-https://your-server.com}",
    "serviceId": "${2:-default}",
    "userKey": "${3}"
  }
}
```

## Verification

Test your connection:

```bash
curl -X GET "${1:-https://your-server.com}/health" \
  -H "x-tdai-service-id: ${2:-default}" \
  -H "x-tdai-user-key: ${3}"
```

Expected response:
```json
{"status": "ok", "version": "1.0.0"}
```

## Usage Examples

### Search Knowledge
```bash
curl -X POST "${1}/api/v1/memory/search" \
  -H "x-tdai-service-id: ${2}" \
  -H "x-tdai-user-key: ${3}" \
  -H "Content-Type: application/json" \
  -d '{"query": "your search query"}'
```

### Sync Skills
```bash
curl -X POST "${1}/api/v1/skills/sync" \
  -H "x-tdai-service-id: ${2}" \
  -H "x-tdai-user-key: ${3}" \
  -H "Content-Type: application/json" \
  -d '{"skills": [...]}'
```
