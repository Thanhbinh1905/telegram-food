import type { Env, TelegramCallbackQuery } from '../types';
import { answerCallbackQuery, editMessage } from '../telegram/api';
import {
  getSession,
  upsertRegistration,
  getRegistrationCounts,
  upsertFoodVote,
  getFoodVoteCounts,
  getVoterNames,
  getFoods,
} from '../db/queries';
import {
  buildRegistrationText,
  registrationKeyboard,
  buildVotingText,
  votingKeyboard,
} from '../telegram/messages';
import { getUserDisplayName } from './utils';

// ─── Registration callbacks: reg:eat | reg:skip ───────────────────────────

export async function handleRegistrationCallback(
  env: Env,
  cq: TelegramCallbackQuery,
  action: 'eat' | 'skip'
): Promise<void> {
  const msg = cq.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const userId = String(cq.from.id);
  const userName = getUserDisplayName(cq.from);

  // Find active session
  const { results } = await env.DB
    .prepare(
      `SELECT * FROM lunch_sessions
       WHERE chat_id = ? AND status = 'REGISTRATION'
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(chatId)
    .all<any>();

  const session = results[0];
  if (!session) {
    await answerCallbackQuery(env, cq.id, '⚠️ Không có phiên đăng ký nào đang mở.', true);
    return;
  }
  if (Number(session.message_id) !== msg.message_id) {
    await answerCallbackQuery(
      env,
      cq.id,
      'ℹ️ Hãy dùng nút ở tin nhắn mới nhất của phiên này.',
      true
    );
    return;
  }

  const eating: 0 | 1 = action === 'eat' ? 1 : 0;
  await upsertRegistration(env.DB, session.id, userId, userName, eating);

  const counts = await getRegistrationCounts(env.DB, session.id);
  const text = buildRegistrationText(session.registration_deadline, counts.eat, counts.skip);

  await editMessage(env, chatId, msg.message_id, text, {
    reply_markup: registrationKeyboard(),
  });

  await answerCallbackQuery(
    env,
    cq.id,
    action === 'eat' ? '🍚 Đã đăng ký ăn!' : '🚫 Đã đăng ký không ăn!'
  );
}

// ─── Vote callbacks: vote:<sessionId>:<round>:yes|no ─────────────────────

export async function handleVoteCallback(
  env: Env,
  cq: TelegramCallbackQuery,
  sessionId: number,
  round: number,
  choice: 'yes' | 'no'
): Promise<void> {
  const msg = cq.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const userId = String(cq.from.id);

  const session = await getSession(env.DB, sessionId);
  if (!session || session.status !== 'VOTING' || session.current_round !== round) {
    await answerCallbackQuery(env, cq.id, '⏰ Vòng vote này đã kết thúc.', true);
    return;
  }
  if (Number(session.message_id) !== msg.message_id) {
    await answerCallbackQuery(
      env,
      cq.id,
      'ℹ️ Hãy dùng nút ở tin nhắn mới nhất của phiên này.',
      true
    );
    return;
  }

  // Must be an eater
  const regRow = await env.DB
    .prepare(
      'SELECT eating FROM registrations WHERE session_id = ? AND user_id = ? AND eating = 1'
    )
    .bind(sessionId, userId)
    .first<{ eating: number }>();

  if (!regRow) {
    await answerCallbackQuery(env, cq.id, '🚫 Bạn không tham gia ăn trưa hôm nay.', true);
    return;
  }

  const vote: 0 | 1 = choice === 'yes' ? 1 : 0;
  await upsertFoodVote(env.DB, sessionId, round, session.current_food_id!, userId, vote);

  // Get vote counts + names for display
  const counts = await getFoodVoteCounts(env.DB, sessionId, round);
  const voterNames = await getVoterNames(env.DB, sessionId, round);
  const voteDeadlineTs = session.vote_deadline ?? Math.floor(Date.now() / 1000);

  // Get food name
  const food = await env.DB
    .prepare('SELECT name FROM foods WHERE id = ?')
    .bind(session.current_food_id)
    .first<{ name: string }>();

  // Count total available foods for display
  const allFoods = await getFoods(env.DB, chatId);

  const text = buildVotingText(
    round,
    allFoods.length,
    food?.name ?? '?',
    session.eaters_count,
    counts.yes,
    counts.no,
    voteDeadlineTs,
    voterNames
  );

  await editMessage(env, chatId, msg.message_id, text, {
    reply_markup: votingKeyboard(sessionId, round),
  });

  await answerCallbackQuery(
    env,
    cq.id,
    choice === 'yes' ? '👍 Đã vote ăn!' : '👎 Đã vote không ăn!'
  );
}
