// Waiting out providers' rate limits. One reply that uses tools makes several
// requests (one per step), and free tiers allow only a few a minute (Gemini's
// free tier: 5 for some models). When a provider answers "too many requests,
// retry in 12 s", the chat says so and tries again after that, instead of
// failing; a daily quota that's used up isn't waited for.

export const PROVIDER_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Gemini",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};

// Longest single wait, and the most one reply waits in all.
const MAX_WAIT_S = 65;
const MAX_TOTAL_S = 180;
// When the provider doesn't say how long.
const DEFAULT_WAIT_S = 15;

// "Per day" quotas (Gemini names them …PerDay…), or no credit left: waiting won't help.
const LONG_TERM = /per ?day|perday|daily|insufficient_quota|billing_hard_limit|credits/i;

interface Limit {
  seconds: number | null;
  longTerm: boolean;
}

async function readLimit(res: Response): Promise<Limit> {
  const body = await res.text().catch(() => "");
  const header = res.headers.get("retry-after-ms") ?? res.headers.get("retry-after");
  let seconds: number | null = null;
  if (res.headers.get("retry-after-ms")) seconds = Number(header) / 1000;
  else if (header) seconds = /^\d+(\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
  // Gemini says it in the body: "Please retry in 12.01s" and "retryDelay": "12s".
  const said = /retry in ([\d.]+)\s*s/i.exec(body) ?? /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(body);
  if (said) seconds = Math.max(seconds ?? 0, Number(said[1]));
  return { seconds: seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : null, longTerm: LONG_TERM.test(body) };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

// A fetch for the provider SDKs that waits out "429 Too Many Requests". One
// per reply, so the wait budget covers the whole reply (and the SDKs' own
// retries). `status` shows a line in the chat while waiting (null clears it).
export function patientFetch(provider: string, signal: AbortSignal, status: (message: string | null) => void): typeof fetch {
  let waited = 0;
  const name = PROVIDER_NAMES[provider] ?? provider;
  return async (input, init) => {
    for (;;) {
      const res = await fetch(input, init);
      if (res.status !== 429) return res;
      const limit = await readLimit(res.clone());
      const seconds = Math.ceil((limit.seconds ?? DEFAULT_WAIT_S) + 0.5);
      if (limit.longTerm || seconds > MAX_WAIT_S || waited + seconds > MAX_TOTAL_S) return res;
      waited += seconds;
      status(`Waiting ${seconds} s: ${name} allows only so many requests a minute…`);
      try {
        await sleep(seconds * 1000, signal);
      } finally {
        status(null);
      }
    }
  };
}

// A plain explanation of a rate-limit or quota error, or null for other errors.
export function explainLimit(provider: string, err: unknown): string | null {
  const e = err as { statusCode?: number; status?: number; lastError?: { statusCode?: number; message?: string }; message?: string };
  const status = e?.statusCode ?? e?.status ?? e?.lastError?.statusCode;
  const text = `${e?.message ?? ""} ${e?.lastError?.message ?? ""}`;
  if (status !== 429 && !/quota|rate.?limit|too many requests/i.test(text)) return null;
  const name = PROVIDER_NAMES[provider] ?? provider;
  if (/per ?day|perday|daily/i.test(text))
    return `${name}'s daily quota for this model is used up. It resets tomorrow; until then, pick another model, or add billing to your ${name} account.`;
  if (/insufficient_quota|billing|credits/i.test(text) && !/per ?minute|retry in/i.test(text))
    return `${name} says there's no credit left on your account. Add billing or credit there, or pick another provider.`;
  return `${name} kept saying "too many requests", even after waiting. A reply that uses tools needs several requests, and free tiers allow only a few a minute. Wait a minute and say "continue", or pick another model.`;
}
