import type { Env, LunchSession } from '../types';
import { sendMessage, editMessage } from '../telegram/api';
import {
  getSessionsDueForLock,
  getSessionsLockedNeedingRound,
  getSessionsDueForVoteEval,
  getRegistrationCounts,
  getEatersCount,
  updateSessionStatus,
  getAvailableFoods,
  markFoodRejected,
  getFoodVoteCounts,
  getActiveSession,
  createSession,
  updateSessionMessageId,
  getFoods,
  getGroupsForAutoLunch,
} from '../db/queries';
import {
  buildLockedText,
  buildVotingText,
  votingKeyboard,
  buildRejectedText,
  buildWinnerText,
  buildNoFoodText,
  buildRegistrationText,
  registrationKeyboard,
} from '../telegram/messages';

const VOTE_TIMEOUT_SECONDS = 60;

// ─── Main cron entry point ───────────────────────────────────────────────────

export async function runCron(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Chạy tuần tự: lock trước → evaluate → pick round mới
  await autoLunchIfNeeded(env, now);
  await lockExpiredRegistrations(env, now);
  await evaluateExpiredVotes(env, now);
  await startRoundsForLockedSessions(env);
}

// ─── Auto-lunch lúc 10:00 ICT (03:00 UTC) ────────────────────────────────────

async function autoLunchIfNeeded(env: Env, now: number): Promise<void> {
  // Chỉ chạy đúng phút 03:00 UTC (= 10:00 ICT)
  const d = new Date(now * 1000);
  if (d.getUTCHours() !== 3 || d.getUTCMinutes() !== 0) return;

  const chatIds = await getGroupsForAutoLunch(env.DB);

  for (const chatId of chatIds) {
    // Bỏ qua nếu đã có session hôm nay
    const existing = await getActiveSession(env.DB, chatId);
    if (existing) continue;

    // Bỏ qua nếu không có món nào
    const foods = await getFoods(env.DB, chatId);
    if (foods.length === 0) continue;

    // Tính deadline 11:11 ICT = 04:11 UTC
    const d2 = new Date(now * 1000);
    const deadline = Math.floor(
      Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate(), 4, 11, 0) / 1000
    );

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
}

// ─── Step 1: Lock registration when deadline passes ──────────────────────────

async function lockExpiredRegistrations(env: Env, now: number): Promise<void> {
  const sessions = await getSessionsDueForLock(env.DB, now);

  for (const session of sessions) {
    const counts = await getRegistrationCounts(env.DB, session.id);
    const eatersCount = counts.eat;

    await updateSessionStatus(env.DB, session.id, 'LOCKED', {
      eaters_count: eatersCount,
    });

    if (session.message_id) {
      await editMessage(
        env,
        session.chat_id,
        session.message_id,
        buildLockedText(counts.eat, counts.skip)
      );
    }

    // Edge case: nobody eating
    if (eatersCount === 0) {
      await updateSessionStatus(env.DB, session.id, 'COMPLETED', {
        result: 'NO_FOOD',
      });
      await sendMessage(
        env,
        session.chat_id,
        '💀 Không ai đăng ký ăn trưa hôm nay. Tự lo nhé 😅'
      );
    }
  }
}

// ─── Step 2: Start roulette round for LOCKED sessions ────────────────────────

async function startRoundsForLockedSessions(env: Env): Promise<void> {
  const sessions = await getSessionsLockedNeedingRound(env.DB);

  for (const session of sessions) {
    await startNewRound(env, session);
  }
}

// ─── Step 3: Evaluate votes when vote_deadline passes ───────────────────────

async function evaluateExpiredVotes(env: Env, now: number): Promise<void> {
  const sessions = await getSessionsDueForVoteEval(env.DB, now);

  for (const session of sessions) {
    await evaluateRound(env, session);
  }
}

// ─── Core: start a new roulette round ────────────────────────────────────────

export async function startNewRound(env: Env, session: LunchSession): Promise<void> {
  const available = await getAvailableFoods(env.DB, session.chat_id, session.id);

  if (available.length === 0) {
    // All foods rejected
    await updateSessionStatus(env.DB, session.id, 'COMPLETED', {
      result: 'NO_FOOD',
    });

    if (session.message_id) {
      await editMessage(env, session.chat_id, session.message_id, buildNoFoodText());
    } else {
      await sendMessage(env, session.chat_id, buildNoFoodText());
    }
    return;
  }

  // Random pick from available
  const food = available[Math.floor(Math.random() * available.length)];
  const newRound = session.current_round + 1;
  const voteDeadline = Math.floor(Date.now() / 1000) + VOTE_TIMEOUT_SECONDS;
  const totalFoods = (await env.DB.prepare('SELECT COUNT(*) AS cnt FROM foods WHERE chat_id = ?').bind(session.chat_id).first<{ cnt: number }>())?.cnt ?? available.length;

  await updateSessionStatus(env.DB, session.id, 'VOTING', {
    current_food_id: food.id,
    current_round: newRound,
    vote_deadline: voteDeadline,
  });

  const text = buildVotingText(
    newRound,
    totalFoods,
    food.name,
    session.eaters_count,
    0,
    0,
    voteDeadline
  );

  if (session.message_id) {
    await editMessage(env, session.chat_id, session.message_id, text, {
      reply_markup: votingKeyboard(session.id, newRound),
    });
  } else {
    const res = await sendMessage(env, session.chat_id, text, {
      reply_markup: votingKeyboard(session.id, newRound),
    });
    if (res.ok && res.result?.message_id) {
      const { updateSessionMessageId } = await import('../db/queries');
      await updateSessionMessageId(env.DB, session.id, res.result.message_id);
    }
  }
}

// ─── Core: evaluate completed vote round ─────────────────────────────────────

export async function evaluateRound(env: Env, session: LunchSession): Promise<void> {
  const round = session.current_round;
  const foodId = session.current_food_id!;
  const eatersCount = session.eaters_count;

  const counts = await getFoodVoteCounts(env.DB, session.id, round);
  const noVotes = counts.no;

  // Get food name
  const food = await env.DB
    .prepare('SELECT name FROM foods WHERE id = ?')
    .bind(foodId)
    .first<{ name: string }>();
  const foodName = food?.name ?? 'Món ăn';

  // Rule: > 50% of eaters voted NO → reject
  const isRejected = noVotes > eatersCount / 2;

  if (isRejected) {
    await markFoodRejected(env.DB, session.id, foodId);

    // Move back to LOCKED — startRoundsForLockedSessions sẽ pick round mới trong cùng cron tick
    await updateSessionStatus(env.DB, session.id, 'LOCKED');

    const rejectedText = buildRejectedText(foodName, counts.yes, counts.no);
    if (session.message_id) {
      await editMessage(env, session.chat_id, session.message_id, rejectedText);
    } else {
      await sendMessage(env, session.chat_id, rejectedText);
    }
  } else {
    // Winner!
    await updateSessionStatus(env.DB, session.id, 'COMPLETED', {
      result: 'WINNER',
      winner_food_id: foodId,
    });

    const winnerText = buildWinnerText(foodName, counts.yes, counts.no, eatersCount);
    if (session.message_id) {
      await editMessage(env, session.chat_id, session.message_id, winnerText);
    } else {
      await sendMessage(env, session.chat_id, winnerText);
    }
  }
}
