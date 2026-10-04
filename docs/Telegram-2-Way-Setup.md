# Telegram 2-Way Communication Setup Guide

## Overview

This guide explains how to enable interactive Yes/No buttons in Telegram notifications from pi-harness, allowing users to approve or reject jobs directly from their Telegram chat.

```
┌─────────────────────────────────────────────────────────────┐
│  pi-harness (pi.dev extension)                            │
│  nc(event, ctx) → TelegramAdapter.send()                  │
│  - Sends message WITH inline keyboard buttons              │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Telegram Bot API                                          │
│  - Receives button clicks                                  │
│  - Forwards to webhook URL                                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS POST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Webhook Server (scripts/telegram-webhook-server.ts)       │
│  POST /api/telegram/webhook                                │
│  - Verifies secret token                                   │
│  - Parses callback_query                                  │
│  - Writes to callback queue                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ File poll
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Callback Processor (scripts/telegram-callback-processor.ts)│
│  - Polls callback queue file                              │
│  - Triggers jobManager.resume() or jobManager.cancel()   │
└─────────────────────────────────────────────────────────────┘
```

---

## Step 1: Create Telegram Bot

### 1.1 Get Bot Token from BotFather

```bash
# 1. Open Telegram and search for @BotFather
# 2. Send /newbot
# 3. Follow prompts:
#    - Choose a name (e.g., "Pi Harness Bot")
#    - Choose a username (e.g., PiHarnessRuntimeBot)
# 4. Copy the bot token (format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
```

### 1.2 Get Your Chat ID

```bash
# 1. Open Telegram and search for @userinfobot
# 2. Send /start
# 3. Reply shows your numeric user ID (e.g., 123456789)
```

### 1.3 Save Credentials

```bash
# Create keys directory
mkdir -p ~/.pi-harness-runtime/keys

# Save bot token
echo "YOUR_BOT_TOKEN" > ~/.pi-harness-runtime/keys/telegram-bot-token.txt

# Save chat ID
echo "YOUR_CHAT_ID" > ~/.pi-harness-runtime/keys/telegram-chat-id.txt
```

---

## Step 2: Set Up Webhook Server

The webhook server receives button clicks from Telegram and queues them for pi-harness.

### 2.1 Start the Webhook Server

```bash
# Generate a secret token for verification
WEBHOOK_SECRET=$(openssl rand -hex 16)
echo $WEBHOOK_SECRET

# Set your public webhook URL (must be HTTPS)
# For local testing, use ngrok or similar
TELEGRAM_WEBHOOK_URL="https://yourdomain.com/api/telegram/webhook"

# Start the server
TELEGRAM_BOT_TOKEN="your-bot-token" \
TELEGRAM_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
TELEGRAM_WEBHOOK_URL="$TELEGRAM_WEBHOOK_URL" \
bun run scripts/telegram-webhook-server.ts
```

### 2.2 Verify Webhook is Set

```bash
# Check webhook status
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "url": "https://yourdomain.com/api/telegram/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

### 2.3 Test Webhook Server

```bash
# Send a test message to verify your bot is working
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "YOUR_CHAT_ID", "text": "Test from webhook server"}'
```

---

## Step 3: Start Callback Processor

The callback processor polls the queue file and triggers job resume/cancel actions.

### 3.1 Configure Callback Handlers

Edit `scripts/telegram-callback-processor.ts` to add your job management logic:

```typescript
const stop = startCallbackPolling({
  queueFile,
  onApprove: async (jobId) => {
    console.log(`✅ APPROVE: ${jobId}`);
    // TODO: Call jobManager.resume(jobId)
  },
  onReject: async (jobId) => {
    console.log(`❌ REJECT: ${jobId}`);
    // TODO: Call jobManager.cancel(jobId)
  },
});
```

### 3.2 Start the Processor

```bash
# Start in background
bun run scripts/telegram-callback-processor.ts &
```

---

## Step 4: Configure pi-harness notify() with Buttons

Update your notification code to include inline keyboard buttons:

### 4.1 Using notifyWithApproval()

```typescript
import { NotificationCenter } from "@pi-harness/notification";

// Send approval request with Yes/No buttons
await center.notifyWithApproval("HumanReviewNeeded", {
  jobId: "job-123",
  requirement: "Review code changes before deployment",
});
```

### 4.2 Using notifyWithButtons() for Custom Actions

```typescript
await center.notifyWithButtons("HumanReviewNeeded", {
  jobId: "job-123",
  requirement: "Review code changes",
}, [
  { text: "✅ Approve", action: "approve", targetId: "job-123" },
  { text: "❌ Reject", action: "reject", targetId: "job-123" },
  { text: "📋 View Logs", action: "view", targetId: "job-123", url: "https://logs.example.com/job-123" },
]);
```

### 4.3 Message Flow

When `notifyWithApproval()` is called:

1. pi-harness sends Telegram message with inline buttons
2. User clicks "Approve" or "Reject" in Telegram
3. Telegram sends callback to webhook server
4. Webhook server writes to callback queue
5. Callback processor polls queue and triggers action
6. User receives confirmation message in Telegram

---

## Step 5: Verify Full Flow

### 5.1 Check Callback Queue

```bash
# View pending callbacks
cat ~/.pi-harness-runtime/callback-queue.jsonl
```

### 5.2 Test Button Click

1. Trigger a notification that requires approval
2. Check Telegram for the message with buttons
3. Click "Approve" or "Reject"
4. Check callback queue for new entry
5. Check callback processor output for action taken

### 5.3 Expected Output

In callback processor:
```
✅ APPROVE: job-123
```

In Telegram chat:
```
✅ Approved! Job job-123 will resume.
```

---

## Architecture Details

### Callback Data Format

Button clicks send callback data in format: `action_targetId`

| Action | Example Callback Data | Meaning |
|--------|---------------------|---------|
| approve | `approve_job-123` | Resume job-123 |
| reject | `reject_job-123` | Cancel job-123 |
| view | `view_job-123` | View job-123 details |

### Queue File Format

Each line in the queue is JSON:
```json
{"timestamp":"2024-01-01T00:00:00Z","queryId":"123","userId":123456789,"username":"johndoe","data":"approve_job-123","action":"approve","targetId":"job-123"}
```

### Security

- Webhook secret token prevents unauthorized callbacks
- Chat ID restricts messages to specific users
- Callback queue is user-specific (username/userId logged)

---

## Troubleshooting

### Webhook not receiving callbacks

```bash
# Check webhook is set correctly
curl "https://api.telegram.org/botTOKEN/getWebhookInfo"

# Check pending updates
# If pending_update_count > 0, your server might not be responding

# Delete and re-set webhook
curl -X POST "https://api.telegram.org/botTOKEN/deleteWebhook"
curl -X POST "https://api.telegram.org/botTOKEN/setWebhook" -d '{"url":"YOUR_URL","secret_token":"YOUR_SECRET"}'
```

### Callback not processing

```bash
# Check queue file exists and has content
cat ~/.pi-harness-runtime/callback-queue.jsonl

# Check callback processor is running
ps aux | grep telegram-callback

# Manually process queue
bun run scripts/telegram-callback-processor.ts
```

### Bot not sending messages

```bash
# Test bot token is valid
curl "https://api.telegram.org/botTOKEN/getMe"

# Check chat ID is correct
# Bot can only send to registered chat IDs
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Secret for webhook verification |
| `TELEGRAM_WEBHOOK_URL` | No | Public URL for webhook (auto-set if not provided) |
| `CALLBACK_QUEUE_FILE` | No | Path to callback queue file |
| `PORT` | No | Webhook server port (default: 3000) |
