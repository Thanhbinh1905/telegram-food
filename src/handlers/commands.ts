import type { Env, LunchSession, TelegramMessage } from '../types';
import { sendMessage, editMessage, isGroupAdmin } from '../telegram/api';
import {
  getFoods,
  addFood,
  removeFood,
  getActiveSession,
  createSession,
  updateSessionMessageId,
  getRegistrationCounts,
  getEatersCount,
  getFoodVoteCounts,
  getVoterNames,
  updateSessionStatus,
} from '../db/queries';
import {
  buildRegistrationText,
  registrationKeyboard,
  buildLockedText,
  buildVotingText,
  votingKeyboard,
} from '../telegram/messages';
import { startNewRound } from './cron';

// ─── /cancellunch — admin only: hủy phiên đang chạy ─────────────────────────

export async function handleCancelLunch(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const userId = msg.from?.id;

  if (!userId) return;

  if (msg.chat.type !== 'private') {
    const admin = await isGroupAdmin(env, msg.chat.id, userId);
    if (!admin) {
      await sendMessage(env, chatId, '🚫 Chỉ admin group mới được hủy phiên ăn trưa.');
      return;
    }
  }

  const session = await getActiveSession(env.DB, chatId);
  if (!session) {
    await sendMessage(env, chatId, '⚠️ Không có phiên ăn trưa nào đang chạy.');
    return;
  }

  await updateSessionStatus(env.DB, session.id, 'COMPLETED', { result: 'NO_FOOD' });

  if (session.message_id) {
    const { editMessage } = await import('../telegram/api');
    await editMessage(env, chatId, session.message_id, '❌ <b>Phiên ăn trưa đã bị hủy.</b>');
  }

  await sendMessage(env, chatId, '🗑️ Đã hủy phiên ăn trưa. Dùng /lunch để bắt đầu lại.');
}

// ─── /go — admin only: lock ngay và bắt đầu roulette ────────────────────────

export async function handleGo(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const userId = msg.from?.id;

  if (!userId) return;

  // Chỉ hoạt động trong group/supergroup
  if (msg.chat.type === 'private') {
    await sendMessage(env, chatId, '⚠️ Lệnh này chỉ dùng trong group.');
    return;
  }

  // Kiểm tra admin
  const admin = await isGroupAdmin(env, msg.chat.id, userId);
  if (!admin) {
    await sendMessage(env, chatId, '🚫 Chỉ admin group mới được dùng lệnh này.');
    return;
  }

  // Lấy session đang REGISTRATION
  const session = await getActiveSession(env.DB, chatId);
  if (!session) {
    await sendMessage(env, chatId, '⚠️ Không có phiên ăn trưa nào đang mở. Dùng /lunch trước.');
    return;
  }
  if (session.status !== 'REGISTRATION') {
    await sendMessage(env, chatId, '⚠️ Phiên này đã được chốt rồi.');
    return;
  }

  // Lock ngay
  const eatersCount = await getEatersCount(env.DB, session.id);
  const counts = await getRegistrationCounts(env.DB, session.id);

  await updateSessionStatus(env.DB, session.id, 'LOCKED', { eaters_count: eatersCount });

  // Edit message đăng ký → hiện trạng thái locked
  if (session.message_id) {
    const { editMessage } = await import('../telegram/api');
    await editMessage(env, chatId, session.message_id, buildLockedText(counts.eat, counts.skip));
  }

  if (eatersCount === 0) {
    await updateSessionStatus(env.DB, session.id, 'COMPLETED', { result: 'NO_FOOD' });
    await sendMessage(env, chatId, '💀 Không ai đăng ký ăn trưa. Tự lo nhé 😅');
    return;
  }

  // Bắt đầu roulette ngay
  const fresh = await (await import('../db/queries')).getSession(env.DB, session.id);
  if (fresh) await startNewRound(env, fresh);
}

// ─── /help ───────────────────────────────────────────────────────────────────

export async function handleHelp(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  await sendMessage(
    env,
    chatId,
    `🍱 <b>Lunch Roulette — Danh sách lệnh</b>\n\n` +
    `<b>Quản lý món ăn (chỉ admin):</b>\n` +
    `/foods — Xem danh sách món\n` +
    `/addfood [tên] — Thêm món mới\n` +
    `/removefood [tên] — Xóa món\n\n` +
    `<b>Ăn trưa:</b>\n` +
    `/lunch — Mở phiên đăng ký ăn trưa\n` +
    `/go — Chốt ngay và bắt đầu roulette (chỉ admin)\n\n` +
    `<b>Luồng hoạt động:</b>\n` +
    `1. Ai đó gọi /lunch\n` +
    `2. Mọi người bấm 🍚 TÔI ĂN hoặc 🚫 KHÔNG ĂN\n` +
    `3. Đến 11:11 → tự động đóng đăng ký\n` +
    `4. Bot random món → vote 👍/👎 trong 60 giây\n` +
    `5. Nếu >50% không thích → đổi món khác\n` +
    `6. Chốt được món → 🎉`
  );
}

// ─── /foods ──────────────────────────────────────────────────────────────────

export async function handleFoods(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const foods = await getFoods(env.DB, chatId);
  if (foods.length === 0) {
    await sendMessage(env, chatId, '📭 Chưa có món nào. Dùng /addfood [tên món] để thêm.');
    return;
  }
  const list = foods.map((f) => `• ${f.name}`).join('\n');
  await sendMessage(env, chatId, `🍽️ <b>Danh sách món:</b>\n\n${list}`);
}

// ─── /addfood ────────────────────────────────────────────────────────────────

export async function handleAddFood(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const userId = msg.from?.id;

  if (!userId) return;

  if (msg.chat.type !== 'private') {
    const admin = await isGroupAdmin(env, msg.chat.id, userId);
    if (!admin) {
      await sendMessage(env, chatId, '🚫 Chỉ admin group mới được thêm món.');
      return;
    }
  }

  const parts = msg.text?.split(' ') ?? [];
  const name = parts.slice(1).join(' ').trim();

  if (!name) {
    await sendMessage(env, chatId, '⚠️ Dùng: /addfood [tên món]');
    return;
  }
  const ok = await addFood(env.DB, chatId, name);
  if (ok) {
    await sendMessage(env, chatId, `✅ Đã thêm <b>${name}</b> vào danh sách!`);
  } else {
    await sendMessage(env, chatId, `⚠️ <b>${name}</b> đã có trong danh sách rồi.`);
  }
}

// ─── /removefood ─────────────────────────────────────────────────────────────

export async function handleRemoveFood(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const userId = msg.from?.id;

  if (!userId) return;

  if (msg.chat.type !== 'private') {
    const admin = await isGroupAdmin(env, msg.chat.id, userId);
    if (!admin) {
      await sendMessage(env, chatId, '🚫 Chỉ admin group mới được xóa món.');
      return;
    }
  }

  const parts = msg.text?.split(' ') ?? [];
  const name = parts.slice(1).join(' ').trim();

  if (!name) {
    await sendMessage(env, chatId, '⚠️ Dùng: /removefood [tên món]');
    return;
  }
  const ok = await removeFood(env.DB, chatId, name);
  if (ok) {
    await sendMessage(env, chatId, `🗑️ Đã xóa <b>${name}</b> khỏi danh sách.`);
  } else {
    await sendMessage(env, chatId, `⚠️ Không tìm thấy <b>${name}</b> trong danh sách.`);
  }
}

// ─── /lunch ──────────────────────────────────────────────────────────────────

export async function handleLunch(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);

  // Check existing active session
  const existing = await getActiveSession(env.DB, chatId);
  if (existing) {
    await reshowActiveSession(env, chatId, existing);
    return;
  }

  // Check food list
  const foods = await getFoods(env.DB, chatId);
  if (foods.length === 0) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Chưa có món nào trong danh sách! Dùng /addfood để thêm món trước.'
    );
    return;
  }

  // Calculate 11:11 deadline (UTC+7 → UTC, tức 04:11 UTC)
  const now = Math.floor(Date.now() / 1000);
  const deadline = getNextDeadline(now);

  const session = await createSession(env.DB, chatId, deadline);
  const counts = await getRegistrationCounts(env.DB, session.id);

  const text = buildRegistrationText(deadline, counts.eat, counts.skip);
  const res = await sendMessage(env, chatId, text, {
    reply_markup: registrationKeyboard(),
  });

  if (res.ok && res.result?.message_id) {
    await updateSessionMessageId(env.DB, session.id, res.result.message_id);
  }
}

async function reshowActiveSession(
  env: Env,
  chatId: string,
  session: LunchSession
): Promise<void> {
  let text: string;
  let extra: object = {};

  switch (session.status) {
    case 'REGISTRATION': {
      const counts = await getRegistrationCounts(env.DB, session.id);
      text = buildRegistrationText(
        session.registration_deadline,
        counts.eat,
        counts.skip
      );
      extra = { reply_markup: registrationKeyboard() };
      break;
    }
    case 'LOCKED': {
      const counts = await getRegistrationCounts(env.DB, session.id);
      text = buildLockedText(counts.eat, counts.skip);
      break;
    }
    case 'VOTING': {
      const foods = await getFoods(env.DB, chatId);
      const food = foods.find(item => item.id === session.current_food_id);
      const counts = await getFoodVoteCounts(env.DB, session.id, session.current_round);
      const voterNames = await getVoterNames(env.DB, session.id, session.current_round);
      text = buildVotingText(
        session.current_round,
        foods.length,
        food?.name ?? '?',
        session.eaters_count,
        counts.yes,
        counts.no,
        session.vote_deadline ?? 0,
        voterNames
      );
      extra = {
        reply_markup: votingKeyboard(session.id, session.current_round),
      };
      break;
    }
    default:
      return;
  }

  const res = await sendMessage(env, chatId, text, extra);
  const newMessageId = res.ok && res.result?.message_id;
  if (!newMessageId) return;

  // Make the new message authoritative before retiring the old one. This also
  // makes any callback arriving from a stale keyboard harmless.
  await updateSessionMessageId(env.DB, session.id, newMessageId);

  if (session.message_id && session.message_id !== newMessageId) {
    await editMessage(
      env,
      chatId,
      session.message_id,
      'ℹ️ <b>Phiên ăn trưa đang hiển thị ở tin nhắn mới nhất.</b>',
      { reply_markup: { inline_keyboard: [] } }
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the unix timestamp for the next 11:11 ICT (04:11 UTC).
 * If it's already past 11:11 ICT today, return tomorrow's.
 */
function getNextDeadline(nowTs: number): number {
  const nowMs = nowTs * 1000;
  const d = new Date(nowMs);

  // Work in UTC but target 04:11 UTC (= 11:11 ICT / UTC+7)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4, 11, 0));

  if (target.getTime() <= nowMs) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return Math.floor(target.getTime() / 1000);
}

// ─── /random ─────────────────────────────────────────────────────────────────

export async function handleRandom(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const raw = (msg.text ?? '').replace(/^\/random\S*\s*/i, '').trim();

  if (!raw) {
    await sendMessage(env, chatId, '⚠️ Dùng: /random bún đậu, thịt chó, phở');
    return;
  }

  const options = raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (options.length < 2) {
    await sendMessage(env, chatId, '⚠️ Cần ít nhất 2 lựa chọn, cách nhau bằng dấu phẩy.\nVí dụ: /random bún đậu, phở, cơm tấm');
    return;
  }

  const pick = options[Math.floor(Math.random() * options.length)];
  await sendMessage(env, chatId, `🎲 <b>${pick}</b>`);
}
