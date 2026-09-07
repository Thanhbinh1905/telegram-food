import type { Env, Food, LunchSession } from '../types';
import { sendMessage, editMessage, inlineKeyboard } from '../telegram/api';

// ─── Registration message ───────────────────────────────────────────────────

export function buildRegistrationText(
  deadlineTs: number,
  eatCount: number,
  noEatCount: number
): string {
  const deadline = formatTime(deadlineTs);
  return (
    `🍱 <b>LUNCH TIME</b>\n\n` +
    `Hôm nay mọi người có ăn trưa cùng team không?\n\n` +
    `⏰ Đăng ký trước ${deadline}\n\n` +
    `━━━━━━━━━━━━━━\n\n` +
    `🍚 Ăn: ${eatCount}\n` +
    `🚫 Không ăn: ${noEatCount}`
  );
}

export function registrationKeyboard() {
  return inlineKeyboard([
    [
      { text: '🍚 TÔI ĂN', callback_data: 'reg:eat' },
      { text: '🚫 TÔI KHÔNG ĂN', callback_data: 'reg:skip' },
    ],
  ]);
}

// ─── Locked message ─────────────────────────────────────────────────────────

export function buildLockedText(eatCount: number, noEatCount: number): string {
  return (
    `🔒 <b>ĐÃ ĐÓNG ĐĂNG KÝ</b>\n\n` +
    `🍚 Ăn: ${eatCount} người\n` +
    `🚫 Không ăn: ${noEatCount} người\n\n` +
    `🎲 Chuẩn bị chọn món...`
  );
}

// ─── Voting message ─────────────────────────────────────────────────────────

export function buildVotingText(
  round: number,
  totalRounds: number,
  foodName: string,
  eatersCount: number,
  yesVotes: number,
  noVotes: number,
  voteDeadlineTs: number,
  voterNames?: { yes: string[]; no: string[]; pending: string[] }
): string {
  const pending = eatersCount - yesVotes - noVotes;
  let text =
    `🎲 <b>ROUND ${round}/${totalRounds}</b>\n\n` +
    `${foodName}\n\n` +
    `${eatersCount} người đang ăn hãy vote:\n\n` +
    `👍 ĂN: ${yesVotes}\n` +
    `👎 KHÔNG ĂN: ${noVotes}\n` +
    `⏳ Chưa vote: ${pending}\n\n` +
    `⏰ Vote kết thúc lúc ${formatTime(voteDeadlineTs)}`;

  if (voterNames) {
    text += '\n\n━━━━━━━━━━━━━━';
    if (voterNames.yes.length > 0)
      text += `\n👍 ${voterNames.yes.join(', ')}`;
    if (voterNames.no.length > 0)
      text += `\n👎 ${voterNames.no.join(', ')}`;
    if (voterNames.pending.length > 0)
      text += `\n⏳ ${voterNames.pending.join(', ')}`;
  }

  return text;
}

export function votingKeyboard(sessionId: number, round: number) {
  return inlineKeyboard([
    [
      { text: '👍 ĂN MÓN NÀY', callback_data: `vote:${sessionId}:${round}:yes` },
      { text: '👎 KHÔNG ĂN', callback_data: `vote:${sessionId}:${round}:no` },
    ],
  ]);
}

// ─── Result messages ─────────────────────────────────────────────────────────

export function buildRejectedText(foodName: string, yesVotes: number, noVotes: number): string {
  return (
    `❌ <b>${foodName.toUpperCase()} BỊ LOẠI</b>\n\n` +
    `👍 ${yesVotes}\n` +
    `👎 ${noVotes}\n\n` +
    `🎲 Đang chọn món khác...`
  );
}

export function buildWinnerText(
  foodName: string,
  yesVotes: number,
  noVotes: number,
  eatersCount: number
): string {
  return (
    `🎉 <b>CHỐT KÈO!</b>\n\n` +
    `${foodName}\n\n` +
    `👍 ${yesVotes}\n` +
    `👎 ${noVotes}\n\n` +
    `👥 ${eatersCount} người ăn trưa hôm nay\n\n` +
    `🍽️ Đi ăn thôi!`
  );
}

export function buildNoFoodText(): string {
  return (
    `💀 <b>Không tìm được món nào.</b>\n\n` +
    `Tất cả món đều bị hơn 50% mọi người reject.\n\n` +
    `Mọi người tự quyết định nhé 🥲`
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatTime(ts: number): string {
  const ICT_OFFSET = 7 * 60 * 60; // UTC+7 in seconds
  const d = new Date((ts + ICT_OFFSET) * 1000);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}
