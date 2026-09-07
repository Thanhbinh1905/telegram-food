import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { isWeekdayInIct, runCron } from "../src/handlers/cron";
import {
  buildLockedText,
  buildRegistrationText,
  buildVotingText,
  registrationKeyboard,
  votingKeyboard,
} from "../src/telegram/messages";
import type { Env } from "../src/types";

const chatId = "-1001234567890";
const testEnv = {
  ...env,
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_SECRET: "test-secret",
} as Env;

type TelegramRequest = {
  method: string;
  body: Record<string, unknown>;
};

let telegramRequests: TelegramRequest[];
let nextMessageId: number;

beforeAll(async () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(chat_id, name)
    );
    CREATE TABLE IF NOT EXISTS lunch_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      message_id INTEGER,
      status TEXT NOT NULL DEFAULT 'REGISTRATION',
      registration_deadline INTEGER NOT NULL,
      current_food_id INTEGER,
      current_round INTEGER NOT NULL DEFAULT 0,
      vote_deadline INTEGER,
      result TEXT,
      winner_food_id INTEGER,
      eaters_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES lunch_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_name TEXT,
      eating INTEGER NOT NULL DEFAULT 1,
      UNIQUE(session_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS food_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES lunch_sessions(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      food_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      vote INTEGER NOT NULL,
      UNIQUE(session_id, round_number, user_id)
    );
    CREATE TABLE IF NOT EXISTS session_rejected_foods (
      session_id INTEGER NOT NULL REFERENCES lunch_sessions(id) ON DELETE CASCADE,
      food_id INTEGER NOT NULL,
      PRIMARY KEY(session_id, food_id)
    );
    CREATE TABLE IF NOT EXISTS group_settings (
      chat_id TEXT PRIMARY KEY,
      auto_lunch INTEGER NOT NULL DEFAULT 1,
      last_seen INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `;
  for (const statement of schema.split(";").map(sql => sql.trim()).filter(Boolean)) {
    await testEnv.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  telegramRequests = [];
  nextMessageId = 100;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(input).split("/").pop()!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      telegramRequests.push({ method, body });

      const result = method === "sendMessage" ? { message_id: nextMessageId++ } : true;
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { "content-type": "application/json" },
      });
    })
  );

  for (const statement of [
    "DELETE FROM food_votes",
    "DELETE FROM session_rejected_foods",
    "DELETE FROM registrations",
    "DELETE FROM lunch_sessions",
    "DELETE FROM foods",
    "DELETE FROM group_settings",
  ]) {
    await testEnv.DB.prepare(statement).run();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function addFood(name: string): Promise<number> {
  const result = await testEnv.DB
    .prepare("INSERT INTO foods (chat_id, name) VALUES (?, ?)")
    .bind(chatId, name)
    .run();
  return Number(result.meta.last_row_id);
}

async function addSession(options: {
  messageId: number;
  status: "REGISTRATION" | "LOCKED" | "VOTING";
  registrationDeadline?: number;
  currentFoodId?: number;
  currentRound?: number;
  voteDeadline?: number;
  eatersCount?: number;
}): Promise<number> {
  const result = await testEnv.DB
    .prepare(
      `INSERT INTO lunch_sessions
       (chat_id, message_id, status, registration_deadline, current_food_id,
        current_round, vote_deadline, eaters_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      chatId,
      options.messageId,
      options.status,
      options.registrationDeadline ?? 1_800_000_000,
      options.currentFoodId ?? null,
      options.currentRound ?? 0,
      options.voteDeadline ?? null,
      options.eatersCount ?? 0
    )
    .run();
  return Number(result.meta.last_row_id);
}

async function addRegistration(
  sessionId: number,
  userId: string,
  userName: string,
  eating: 0 | 1
): Promise<void> {
  await testEnv.DB
    .prepare(
      "INSERT INTO registrations (session_id, user_id, user_name, eating) VALUES (?, ?, ?, ?)"
    )
    .bind(sessionId, userId, userName, eating)
    .run();
}

async function addVote(
  sessionId: number,
  round: number,
  foodId: number,
  userId: string,
  vote: 0 | 1
): Promise<void> {
  await testEnv.DB
    .prepare(
      "INSERT INTO food_votes (session_id, round_number, food_id, user_id, vote) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(sessionId, round, foodId, userId, vote)
    .run();
}

async function postLunchCommand(): Promise<void> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.com", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-secret",
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 999,
          from: { id: 42, first_name: "Captain" },
          chat: { id: Number(chatId), type: "group" },
          text: "/lunch",
          date: 1_800_000_000,
        },
      }),
    }),
    testEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
}

async function postCallback(data: string, messageId: number): Promise<void> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://example.com", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-secret",
      },
      body: JSON.stringify({
        update_id: 2,
        callback_query: {
          id: "callback-1",
          from: { id: 3, first_name: "Cara" },
          message: {
            message_id: messageId,
            chat: { id: Number(chatId), type: "group" },
            date: 1_800_000_000,
          },
          data,
        },
      }),
    }),
    testEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
}

async function sessionCount(): Promise<number> {
  const row = await testEnv.DB
    .prepare("SELECT COUNT(*) AS count FROM lunch_sessions WHERE chat_id = ?")
    .bind(chatId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function requestFor(method: string): TelegramRequest {
  const request = telegramRequests.find(item => item.method === method);
  expect(request).toBeDefined();
  return request!;
}

describe("automatic lunch schedule", () => {
  it.each([
    ["Saturday", "2025-01-04T03:00:00Z"],
    ["Sunday", "2025-01-05T03:00:00Z"],
  ])("does not open automatically on %s", async (_day, timestamp) => {
    await testEnv.DB
      .prepare("INSERT INTO group_settings (chat_id, auto_lunch) VALUES (?, 1)")
      .bind(chatId)
      .run();
    await addFood("Phở");

    await runCron(testEnv, Math.floor(Date.parse(timestamp) / 1000));

    expect(await sessionCount()).toBe(0);
    expect(telegramRequests).toHaveLength(0);
  });

  it("opens automatically on a weekday", async () => {
    await testEnv.DB
      .prepare("INSERT INTO group_settings (chat_id, auto_lunch) VALUES (?, 1)")
      .bind(chatId)
      .run();
    await addFood("Phở");

    await runCron(testEnv, Math.floor(Date.parse("2025-01-06T03:00:00Z") / 1000));

    expect(await sessionCount()).toBe(1);
    expect(requestFor("sendMessage").body.text).toContain("LUNCH TIME");
  });

  it("determines the weekday from ICT, not UTC", () => {
    const fridayUtcEvening = Math.floor(Date.parse("2025-01-03T18:00:00Z") / 1000);

    expect(new Date(fridayUtcEvening * 1000).getUTCDay()).toBe(5);
    expect(isWeekdayInIct(fridayUtcEvening)).toBe(false);
  });
});

describe("/lunch while a session is live", () => {
  it("re-shows registration without creating another session", async () => {
    const deadline = 1_800_000_000;
    const sessionId = await addSession({
      messageId: 10,
      status: "REGISTRATION",
      registrationDeadline: deadline,
    });
    await addRegistration(sessionId, "1", "Alice", 1);
    await addRegistration(sessionId, "2", "Bob", 0);
    await addFood("Phở");

    await postLunchCommand();

    const sent = requestFor("sendMessage");
    expect(sent.body.text).toBe(buildRegistrationText(deadline, 1, 1));
    expect(sent.body.reply_markup).toEqual(registrationKeyboard());
    expect(await sessionCount()).toBe(1);
    expect(
      (await testEnv.DB.prepare("SELECT message_id FROM lunch_sessions WHERE id = ?").bind(sessionId).first<{ message_id: number }>())
        ?.message_id
    ).toBe(100);

    const oldMessage = requestFor("editMessageText");
    expect(oldMessage.body.text).toContain("tin nhắn mới nhất");
    expect(oldMessage.body.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("ignores callbacks from the retired message", async () => {
    const sessionId = await addSession({
      messageId: 10,
      status: "REGISTRATION",
      registrationDeadline: 1_800_000_000,
    });
    await addRegistration(sessionId, "1", "Alice", 1);
    await addFood("Phở");

    await postLunchCommand();
    await postCallback("reg:eat", 10);

    const row = await testEnv.DB
      .prepare("SELECT COUNT(*) AS count FROM registrations WHERE session_id = ? AND user_id = ?")
      .bind(sessionId, "3")
      .first<{ count: number }>();
    expect(row?.count ?? 0).toBe(0);
    expect(requestFor("answerCallbackQuery").body.text).toContain("tin nhắn mới nhất");
    expect(telegramRequests.filter(item => item.method === "editMessageText")).toHaveLength(1);
  });

  it("re-shows a locked session without creating another session", async () => {
    const sessionId = await addSession({ messageId: 11, status: "LOCKED" });
    await addRegistration(sessionId, "1", "Alice", 1);
    await addRegistration(sessionId, "2", "Bob", 1);
    await addRegistration(sessionId, "3", "Cara", 0);
    await addFood("Phở");

    await postLunchCommand();

    expect(requestFor("sendMessage").body.text).toBe(buildLockedText(2, 1));
    expect(requestFor("sendMessage").body.reply_markup).toBeUndefined();
    expect(await sessionCount()).toBe(1);
  });

  it("re-shows the current voting round without creating another session", async () => {
    const foodId = await addFood("Phở");
    await addFood("Bún chả");
    const voteDeadline = 1_800_000_060;
    const sessionId = await addSession({
      messageId: 12,
      status: "VOTING",
      currentFoodId: foodId,
      currentRound: 2,
      voteDeadline,
      eatersCount: 2,
    });
    await addRegistration(sessionId, "1", "Alice", 1);
    await addRegistration(sessionId, "2", "Bob", 1);
    await addVote(sessionId, 2, foodId, "1", 1);
    await addVote(sessionId, 2, foodId, "2", 0);

    await postLunchCommand();

    const sent = requestFor("sendMessage");
    expect(sent.body.text).toBe(
      buildVotingText(2, 2, "Phở", 2, 1, 1, voteDeadline, {
        yes: ["Alice"],
        no: ["Bob"],
        pending: [],
      })
    );
    expect(sent.body.reply_markup).toEqual(votingKeyboard(sessionId, 2));
    expect(await sessionCount()).toBe(1);
  });
});
