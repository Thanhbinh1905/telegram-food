import type { Food, LunchSession, Registration, FoodVote } from '../types';

// ─── Foods ───────────────────────────────────────────────────────────────────

export async function getFoods(db: D1Database, chatId: string): Promise<Food[]> {
  const { results } = await db
    .prepare('SELECT * FROM foods WHERE chat_id = ? ORDER BY name ASC')
    .bind(chatId)
    .all<Food>();
  return results;
}

export async function addFood(db: D1Database, chatId: string, name: string): Promise<boolean> {
  try {
    await db
      .prepare('INSERT INTO foods (chat_id, name) VALUES (?, ?)')
      .bind(chatId, name.trim())
      .run();
    return true;
  } catch {
    return false; // UNIQUE constraint
  }
}

export async function removeFood(db: D1Database, chatId: string, name: string): Promise<boolean> {
  const { meta } = await db
    .prepare('DELETE FROM foods WHERE chat_id = ? AND name = ?')
    .bind(chatId, name.trim())
    .run();
  return (meta.changes ?? 0) > 0;
}

// ─── Lunch Sessions ──────────────────────────────────────────────────────────

export async function getActiveSession(
  db: D1Database,
  chatId: string
): Promise<LunchSession | null> {
  const row = await db
    .prepare(
      `SELECT * FROM lunch_sessions
       WHERE chat_id = ? AND status NOT IN ('COMPLETED')
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(chatId)
    .first<LunchSession>();
  return row ?? null;
}

export async function createSession(
  db: D1Database,
  chatId: string,
  registrationDeadline: number
): Promise<LunchSession> {
  const { meta } = await db
    .prepare(
      `INSERT INTO lunch_sessions (chat_id, registration_deadline)
       VALUES (?, ?)`
    )
    .bind(chatId, registrationDeadline)
    .run();
  const session = await db
    .prepare('SELECT * FROM lunch_sessions WHERE id = ?')
    .bind(meta.last_row_id)
    .first<LunchSession>();
  return session!;
}

export async function updateSessionMessageId(
  db: D1Database,
  sessionId: number,
  messageId: number
): Promise<void> {
  await db
    .prepare('UPDATE lunch_sessions SET message_id = ? WHERE id = ?')
    .bind(messageId, sessionId)
    .run();
}

export async function updateSessionStatus(
  db: D1Database,
  sessionId: number,
  status: string,
  extra: Partial<{
    current_food_id: number | null;
    current_round: number;
    vote_deadline: number | null;
    result: string | null;
    winner_food_id: number | null;
    eaters_count: number;
  }> = {}
): Promise<void> {
  const sets: string[] = ['status = ?'];
  const vals: any[] = [status];

  for (const [key, val] of Object.entries(extra)) {
    sets.push(`${key} = ?`);
    vals.push(val);
  }
  vals.push(sessionId);

  await db
    .prepare(`UPDATE lunch_sessions SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();
}

export async function getSession(db: D1Database, id: number): Promise<LunchSession | null> {
  return db.prepare('SELECT * FROM lunch_sessions WHERE id = ?').bind(id).first<LunchSession>() ?? null;
}

// ─── Registrations ───────────────────────────────────────────────────────────

export async function upsertRegistration(
  db: D1Database,
  sessionId: number,
  userId: string,
  userName: string | null,
  eating: 0 | 1
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO registrations (session_id, user_id, user_name, eating)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET eating = excluded.eating, user_name = excluded.user_name`
    )
    .bind(sessionId, userId, userName, eating)
    .run();
}

export async function getRegistrationCounts(
  db: D1Database,
  sessionId: number
): Promise<{ eat: number; skip: number }> {
  const row = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN eating = 1 THEN 1 ELSE 0 END) AS eat,
        SUM(CASE WHEN eating = 0 THEN 1 ELSE 0 END) AS skip
       FROM registrations WHERE session_id = ?`
    )
    .bind(sessionId)
    .first<{ eat: number; skip: number }>();
  return { eat: row?.eat ?? 0, skip: row?.skip ?? 0 };
}

export async function getEatersCount(db: D1Database, sessionId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS cnt FROM registrations WHERE session_id = ? AND eating = 1')
    .bind(sessionId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// ─── Food Votes ──────────────────────────────────────────────────────────────

export async function upsertFoodVote(
  db: D1Database,
  sessionId: number,
  round: number,
  foodId: number,
  userId: string,
  vote: 0 | 1
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO food_votes (session_id, round_number, food_id, user_id, vote)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, round_number, user_id) DO UPDATE SET vote = excluded.vote`
    )
    .bind(sessionId, round, foodId, userId, vote)
    .run();
}

export async function getFoodVoteCounts(
  db: D1Database,
  sessionId: number,
  round: number
): Promise<{ yes: number; no: number }> {
  const row = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS yes,
        SUM(CASE WHEN vote = 0 THEN 1 ELSE 0 END) AS no
       FROM food_votes WHERE session_id = ? AND round_number = ?`
    )
    .bind(sessionId, round)
    .first<{ yes: number; no: number }>();
  return { yes: row?.yes ?? 0, no: row?.no ?? 0 };
}

export async function getVoterNames(
  db: D1Database,
  sessionId: number,
  round: number
): Promise<{ yes: string[]; no: string[]; pending: string[] }> {
  // Ai đã vote trong round này
  const { results: votes } = await db
    .prepare(
      `SELECT fv.user_id, fv.vote, r.user_name
       FROM food_votes fv
       JOIN registrations r ON r.session_id = fv.session_id AND r.user_id = fv.user_id
       WHERE fv.session_id = ? AND fv.round_number = ?`
    )
    .bind(sessionId, round)
    .all<{ user_id: string; vote: number; user_name: string | null }>();

  // Ai chưa vote (eaters chưa có trong food_votes round này)
  const { results: pending } = await db
    .prepare(
      `SELECT r.user_id, r.user_name
       FROM registrations r
       WHERE r.session_id = ? AND r.eating = 1
         AND r.user_id NOT IN (
           SELECT user_id FROM food_votes WHERE session_id = ? AND round_number = ?
         )`
    )
    .bind(sessionId, sessionId, round)
    .all<{ user_id: string; user_name: string | null }>();

  const label = (name: string | null, id: string) => name ?? `#${id}`;

  return {
    yes: votes.filter(v => v.vote === 1).map(v => label(v.user_name, v.user_id)),
    no:  votes.filter(v => v.vote === 0).map(v => label(v.user_name, v.user_id)),
    pending: pending.map(p => label(p.user_name, p.user_id)),
  };
}

// ─── Rejected Foods ──────────────────────────────────────────────────────────

export async function markFoodRejected(
  db: D1Database,
  sessionId: number,
  foodId: number
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO session_rejected_foods (session_id, food_id) VALUES (?, ?)'
    )
    .bind(sessionId, foodId)
    .run();
}

export async function getAvailableFoods(
  db: D1Database,
  chatId: string,
  sessionId: number
): Promise<Food[]> {
  const { results } = await db
    .prepare(
      `SELECT f.* FROM foods f
       WHERE f.chat_id = ?
         AND f.id NOT IN (
           SELECT food_id FROM session_rejected_foods WHERE session_id = ?
         )
       ORDER BY f.id`
    )
    .bind(chatId, sessionId)
    .all<Food>();
  return results;
}

// ─── Pending sessions for cron ───────────────────────────────────────────────

export async function getSessionsDueForLock(db: D1Database, now: number): Promise<LunchSession[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM lunch_sessions
       WHERE status = 'REGISTRATION' AND registration_deadline <= ?`
    )
    .bind(now)
    .all<LunchSession>();
  return results;
}

export async function getSessionsDueForVoteEval(
  db: D1Database,
  now: number
): Promise<LunchSession[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM lunch_sessions
       WHERE status = 'VOTING' AND vote_deadline <= ?`
    )
    .bind(now)
    .all<LunchSession>();
  return results;
}

export async function getSessionsLockedNeedingRound(
  db: D1Database
): Promise<LunchSession[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM lunch_sessions WHERE status = 'LOCKED'`
    )
    .all<LunchSession>();
  return results;
}

// ─── Group settings ───────────────────────────────────────────────────────────

export async function upsertGroupSeen(db: D1Database, chatId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO group_settings (chat_id, last_seen)
       VALUES (?, unixepoch())
       ON CONFLICT(chat_id) DO UPDATE SET last_seen = unixepoch()`
    )
    .bind(chatId)
    .run();
}

export async function getGroupsForAutoLunch(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT chat_id FROM group_settings WHERE auto_lunch = 1`)
    .all<{ chat_id: string }>();
  return results.map(r => r.chat_id);
}
