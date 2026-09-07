#!/usr/bin/env bash
# Setup Telegram webhook for Lunch Roulette bot
# Usage: BOT_TOKEN=xxx WORKER_URL=https://xxx.workers.dev SECRET=yyy ./setup-webhook.sh

set -e

BOT_TOKEN="${BOT_TOKEN:?Set BOT_TOKEN}"
WORKER_URL="${WORKER_URL:?Set WORKER_URL}"
SECRET="${SECRET:-$(openssl rand -hex 16)}"

echo "Setting webhook to: $WORKER_URL"
echo "Secret: $SECRET"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WORKER_URL}\",
    \"secret_token\": \"${SECRET}\",
    \"allowed_updates\": [\"message\", \"callback_query\"]
  }" | jq .

echo ""
echo "Next: add secrets to your worker:"
echo "  wrangler secret put TELEGRAM_BOT_TOKEN"
echo "  wrangler secret put TELEGRAM_SECRET   # value: $SECRET"
