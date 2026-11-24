// AI on our key (docs/cloud-plan.md, "AI"): which models, what they cost us,
// how that turns into credits, and the limits. All of it is configuration,
// never constants in code: the repo is public, and prices and allowances
// change without a commit. Without ANTHROPIC_API_KEY and AI_MODELS, the server
// offers no AI of its own (people still use their own keys in the page).
import { z } from "zod";

const Price = z.object({
  // US dollars per million tokens, as the provider charges them.
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
});

const Model = z.object({
  // What the app asks for ("standard"); stays the same when the model behind it changes.
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  // The provider's model id.
  model: z.string().min(1),
  price: Price,
  // Credits charged per credit of cost: top models can cost more than they cost us.
  rate: z.number().positive().default(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  // The API's server-side refusal fallback ("default" routing).
  fallback: z.boolean().optional(),
  default: z.boolean().optional(),
});

export type AiModel = z.infer<typeof Model>;
export type AiPrice = z.infer<typeof Price>;

export interface AiConfig {
  enabled: boolean;
  apiKey?: string;
  // Another address for the provider's API, e.g. a Cloudflare AI Gateway.
  baseURL?: string;
  models: AiModel[];
  // Credits per US dollar of model cost (before a model's rate).
  creditsPerUsd: number;
  // In credits: once for each new account, and topped up to each month.
  starterCredits: number;
  monthlyCredits: number;
  // In credits: the most an account can spend in a calendar month, whatever
  // its balance (null: no ceiling besides the balance).
  monthlyCeiling: number | null;
  // Our AI only for accounts whose email address is confirmed (when the
  // server can send email; otherwise nobody could confirm one).
  requireVerifiedEmail: boolean;
  maxSteps: number;
  maxOutputTokens: number;
  // A conversation longer than this (estimated input tokens) is continued
  // from a summary of itself, so long chats don't get expensive.
  maxHistoryTokens: number;
  repliesPerMinute: number;
  repliesPerDay: number;
  // Where to buy more credits (Paddle comes in phase 5); none: not offered.
  topUpUrl?: string;
}

const num = (v: string | undefined, fallback: number) => {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`not a number: ${v}`);
  return n;
};

export function aiConfigFrom(env: Record<string, string | undefined>, opts: { emailConfigured: boolean }): AiConfig {
  let models: AiModel[] = [];
  if (env.AI_MODELS?.trim()) {
    const parsed = z.array(Model).min(1).safeParse(JSON.parse(env.AI_MODELS));
    if (!parsed.success) throw new Error(`AI_MODELS: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    models = parsed.data;
    if (new Set(models.map((m) => m.id)).size !== models.length) throw new Error("AI_MODELS: two models have the same id");
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const ceiling = env.AI_MONTHLY_CEILING_CREDITS?.trim();
  return {
    enabled: Boolean(apiKey && models.length),
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined,
    models,
    creditsPerUsd: num(env.AI_CREDITS_PER_USD, 100),
    starterCredits: num(env.AI_STARTER_CREDITS, 0),
    monthlyCredits: num(env.AI_MONTHLY_CREDITS, 0),
    monthlyCeiling: ceiling ? num(ceiling, 0) : null,
    requireVerifiedEmail: env.AI_REQUIRE_VERIFIED_EMAIL ? env.AI_REQUIRE_VERIFIED_EMAIL === "true" : opts.emailConfigured,
    maxSteps: Math.max(1, Math.round(num(env.AI_MAX_STEPS, 25))),
    maxOutputTokens: Math.max(1024, Math.round(num(env.AI_MAX_OUTPUT_TOKENS, 16000))),
    maxHistoryTokens: Math.max(10_000, Math.round(num(env.AI_MAX_HISTORY_TOKENS, 150_000))),
    repliesPerMinute: Math.max(1, Math.round(num(env.AI_REPLIES_PER_MINUTE, 6))),
    repliesPerDay: Math.max(1, Math.round(num(env.AI_REPLIES_PER_DAY, 200))),
    topUpUrl: env.AI_TOP_UP_URL?.trim() || undefined,
  };
}

export const defaultModel = (cfg: AiConfig) => cfg.models.find((m) => m.default) ?? cfg.models[0];

// --- money ------------------------------------------------------------------
// Credits are kept in thousandths ("milli"), costs in millionths of a dollar.

export const MILLI = 1000;
export const toMilli = (credits: number) => Math.round(credits * MILLI);

export interface TokenUse {
  input: number; // not cached
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const costUsd = (p: AiPrice, t: TokenUse) =>
  (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1_000_000;

// What a cost is charged, in millicredits (rounded up: never below cost).
export const chargeFor = (cfg: AiConfig, m: AiModel, usd: number) => Math.ceil(usd * cfg.creditsPerUsd * m.rate * MILLI);

// The most output a step can afford with `available` millicredits after its
// input, or 0 when even the input isn't covered. Input is priced at the
// dearest input rate (a cache write), so the estimate never comes out low.
export function affordableOutput(cfg: AiConfig, m: AiModel, available: number, inputTokens: number): number {
  const perToken = (usdPerMillion: number) => (usdPerMillion / 1_000_000) * cfg.creditsPerUsd * m.rate * MILLI;
  const inputCost = inputTokens * perToken(Math.max(m.price.input, m.price.cacheWrite));
  const left = available - inputCost;
  if (left <= 0) return 0;
  const out = m.price.output > 0 ? Math.floor(left / perToken(m.price.output)) : cfg.maxOutputTokens;
  return Math.min(out, cfg.maxOutputTokens);
}
