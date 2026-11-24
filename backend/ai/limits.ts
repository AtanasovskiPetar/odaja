// How often one account can ask our AI: one reply at a time, and so many a
// minute and a day. In memory, so per server process (like the change events;
// docs/cloud-plan.md phase 2 moves them to Postgres for more than one).
export type LimitRefusal = { ok: false; reason: "busy" | "minute" | "day"; retryAfter: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function createAiLimits(cfg: { repliesPerMinute: number; repliesPerDay: number }) {
  const running = new Set<string>();
  const started = new Map<string, number[]>();

  return {
    // Start a reply; `done` must be called when it ends, however it ends.
    start(userId: string, now = Date.now()): { ok: true; done(): void } | LimitRefusal {
      if (running.has(userId)) return { ok: false, reason: "busy", retryAfter: 5 };
      // Now and then, forget accounts with nothing in the last day.
      if (started.size > 10_000) for (const [id, t] of started) if (now - t.at(-1)! >= DAY) started.delete(id);
      const times = (started.get(userId) ?? []).filter((t) => now - t < DAY);
      const lastMinute = times.filter((t) => now - t < MINUTE);
      if (lastMinute.length >= cfg.repliesPerMinute) return { ok: false, reason: "minute", retryAfter: Math.ceil((lastMinute[0]! + MINUTE - now) / 1000) };
      if (times.length >= cfg.repliesPerDay) return { ok: false, reason: "day", retryAfter: Math.ceil((times[0]! + DAY - now) / 1000) };
      times.push(now);
      started.set(userId, times);
      running.add(userId);
      let ended = false;
      return {
        ok: true,
        done() {
          if (ended) return;
          ended = true;
          running.delete(userId);
        },
      };
    },
  };
}

export type AiLimits = ReturnType<typeof createAiLimits>;
