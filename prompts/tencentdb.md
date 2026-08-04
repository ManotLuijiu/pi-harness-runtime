---
description: Configure TencentDB-Agent-Memory connection
argument-hint: "[server-url]"
---
# Configure TencentDB-Agent-Memory

This command helps you connect to your own TencentDB-Agent-Memory server for centralized knowledge retrieval.

## Options

### 1. Use Default Server (Recommended for Testing)
If you don't have your own server, you can use the public demo:
- **URL**: `https://https://your-memory-server.example.com`
- **Note**: This is a shared server, data may be visible to others

### 2. Deploy Your Own Server
Deploy TencentDB-Agent-Memory on your own VPS:

**Minimal Requirements:**
- 2 vCPU, 4GB RAM, 50GB SSD
- Ubuntu 22.04 LTS
- Docker installed

**Quick Deploy:**
```bash
# SSH into your VPS
ssh user@your-vps-ip

# Install Docker if needed
curl -fsSL https://get.docker.com | sh

# Deploy the server
docker run -d \
  --name tencentdb-memory \
  -p 8080:8080 \
  -e OPENAI_API_KEY=your-api-key \
  ghcr.io/tencentcloud/tdai-memory:latest
```

### 3. Connect via MCP
After deployment, configure the MCP connection:

**Server URL**: `${1:-https://your-vps-ip:8080}`

**Required Headers**:
```
x-tdai-service-id: default
x-tdai-user-key: YOUR_USER_KEY
```

**Available Endpoints**:
- `POST /api/v1/memory/search` - Search knowledge base
- `POST /api/v1/memory/conversation/search` - Search conversations
- `GET /api/v1/health` - Health check

## Configuration

### Quick Setup

To connect to a TencentDB-Agent-Memory server, provide:

1. **Server URL** (e.g., `https://memory.example.com`)
2. **Service ID** (usually `default`)
3. **User Key** (from your server admin)

### Environment Variables

Add to your `.env` or shell profile:

```bash
# TencentDB-Agent-Memory Configuration
TENANTDB_URL=https://your-server.com
TENANTDB_SERVICE_ID=default
TENANTDB_USER_KEY=your-user-key
```

## Next Steps

After configuration, you can:

1. **Search Knowledge**: Use `/search <query>` to find skills and documentation
2. **Sync Skills**: Upload your local skills to the centralized server
3. **Query Code**: Search across all indexed codebases

## Need Help?

- **Documentation**: https://github.com/TencentCloud/TencentDB-Agent-Memory
- **Issues**: Report bugs on the GitHub repository
