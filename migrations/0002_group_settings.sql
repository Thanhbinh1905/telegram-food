-- Track groups that use the bot, for auto-lunch cron
CREATE TABLE IF NOT EXISTS group_settings (
  chat_id TEXT PRIMARY KEY,
  auto_lunch INTEGER NOT NULL DEFAULT 1,  -- 1 = enabled
  last_seen INTEGER NOT NULL DEFAULT (unixepoch())
);
