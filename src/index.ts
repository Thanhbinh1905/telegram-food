import type { Env, TelegramUpdate } from './types';
import { handleFoods, handleAddFood, handleRemoveFood, handleLunch, handleHelp, handleGo, handleCancelLunch, handleRandom } from './handlers/commands';
import { handleRegistrationCallback, handleVoteCallback } from './handlers/callbacks';
import { runCron } from './handlers/cron';
import { upsertGroupSeen } from './db/queries';

export default {
  // ─── Webhook ────────────────────────────────────────────────────────────
  async fetch(request: Request, env: Env): Promise<Response> {
    // Verify secret header
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let update: TelegramUpdate;
    try {
      update = await request.json<TelegramUpdate>();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    try {
      await handleUpdate(env, update);
    } catch (err) {
      console.error('Error handling update:', err);
    }

    return new Response('OK');
  },

  // ─── Cron ────────────────────────────────────────────────────────────────
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await runCron(env);
    } catch (err) {
      console.error('Cron error:', err);
    }
  },
} satisfies ExportedHandler<Env>;

// ─── Update dispatcher ────────────────────────────────────────────────────────

async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  // ── Text messages / commands ──
  if (update.message?.text) {
    const msg = update.message;
    const text = msg.text!.trim();

    // Track group for auto-lunch
    if (msg.chat.type !== 'private') {
      await upsertGroupSeen(env.DB, String(msg.chat.id));
    }

    // Strip bot username from command (e.g. /lunch@MyBot → /lunch)
    const cmd = text.split(' ')[0].split('@')[0].toLowerCase();

    switch (cmd) {
      case '/start':
      case '/help':
        await handleHelp(env, msg);
        break;
      case '/lunch':
        await handleLunch(env, msg);
        break;
      case '/go':
        await handleGo(env, msg);
        break;
      case '/cancellunch':
        await handleCancelLunch(env, msg);
        break;
      case '/random':
        await handleRandom(env, msg);
        break;
      case '/foods':
        await handleFoods(env, msg);
        break;
      case '/addfood':
        await handleAddFood(env, msg);
        break;
      case '/removefood':
        await handleRemoveFood(env, msg);
        break;
      // ignore unknown commands
    }
    return;
  }

  // ── Callback queries ──
  if (update.callback_query) {
    const cq = update.callback_query;
    const data = cq.data ?? '';

    if (data === 'reg:eat') {
      await handleRegistrationCallback(env, cq, 'eat');
    } else if (data === 'reg:skip') {
      await handleRegistrationCallback(env, cq, 'skip');
    } else if (data.startsWith('vote:')) {
      // vote:<sessionId>:<round>:yes|no
      const parts = data.split(':');
      if (parts.length === 4) {
        const sessionId = parseInt(parts[1], 10);
        const round = parseInt(parts[2], 10);
        const choice = parts[3] as 'yes' | 'no';
        if (!isNaN(sessionId) && !isNaN(round) && (choice === 'yes' || choice === 'no')) {
          await handleVoteCallback(env, cq, sessionId, round, choice);
        }
      }
    }
  }
}
