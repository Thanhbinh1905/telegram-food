import type { TelegramUser } from '../types';

export function getUserDisplayName(user: TelegramUser): string {
  if (user.username) return `@${user.username}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || String(user.id);
}
