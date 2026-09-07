import type { Env } from '../types';

const BASE = (token: string) => `https://api.telegram.org/bot${token}`;

async function call(token: string, method: string, body: object): Promise<any> {
  const res = await fetch(`${BASE(token)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  if (!json.ok) {
    console.error(`Telegram API error [${method}]:`, JSON.stringify(json));
  }
  return json;
}

export function sendMessage(
  env: Env,
  chatId: string | number,
  text: string,
  extra: object = {}
): Promise<any> {
  return call(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export function editMessage(
  env: Env,
  chatId: string | number,
  messageId: number,
  text: string,
  extra: object = {}
): Promise<any> {
  return call(env.TELEGRAM_BOT_TOKEN, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<any> {
  return call(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

// Inline keyboard helper
export function inlineKeyboard(buttons: Array<Array<{ text: string; callback_data: string }>>) {
  return { inline_keyboard: buttons };
}

// Check if user is admin/creator in a group
export async function isGroupAdmin(env: Env, chatId: string | number, userId: number): Promise<boolean> {
  const res = await call(env.TELEGRAM_BOT_TOKEN, 'getChatMember', {
    chat_id: chatId,
    user_id: userId,
  });
  if (!res.ok) return false;
  const status = res.result?.status;
  return status === 'administrator' || status === 'creator';
}
