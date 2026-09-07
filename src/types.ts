// ─── Telegram types (minimal subset we need) ───────────────────────────────

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// ─── DB row types ───────────────────────────────────────────────────────────

export type SessionStatus = 'REGISTRATION' | 'LOCKED' | 'VOTING' | 'COMPLETED';
export type SessionResult = 'WINNER' | 'NO_FOOD' | null;

export interface LunchSession {
  id: number;
  chat_id: string;
  message_id: number | null;
  status: SessionStatus;
  registration_deadline: number;
  current_food_id: number | null;
  current_round: number;
  vote_deadline: number | null;
  result: SessionResult;
  winner_food_id: number | null;
  eaters_count: number;
  created_at: number;
}

export interface Food {
  id: number;
  chat_id: string;
  name: string;
  created_at: number;
}

export interface Registration {
  id: number;
  session_id: number;
  user_id: string;
  user_name: string | null;
  eating: number;
}

export interface FoodVote {
  id: number;
  session_id: number;
  round_number: number;
  food_id: number;
  user_id: string;
  vote: number;
}

// ─── Env bindings ───────────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET: string; // webhook secret header
}
