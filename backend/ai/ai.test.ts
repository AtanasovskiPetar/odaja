import { describe, expect, test } from "bun:test";
import { affordableOutput, aiConfigFrom, chargeFor, costUsd, MILLI, type AiConfig } from "./config";
import { createAiLimits } from "./limits";
import { estimateTokens, mostAStepCosts } from "./turn";

const MODELS = JSON.stringify([
  { id: "standard", name: "Odaja AI", model: "claude-sonnet-5-5", price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, default: true },
  { id: "best", name: "Best", model: "claude-opus-5-5", price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, rate: 1.5 },
]);
const cfg: AiConfig = aiConfigFrom({ ANTHROPIC_API_KEY: "x", AI_MODELS: MODELS, AI_MAX_OUTPUT_TOKENS: "16000" }, { emailConfigured: false });
const [standard, best] = cfg.models;

describe("config", () => {
  test("on only with a key and models", () => {
    expect(cfg.enabled).toBe(true);
    expect(aiConfigFrom({ AI_MODELS: MODELS }, { emailConfigured: false }).enabled).toBe(false);
    expect(aiConfigFrom({ ANTHROPIC_API_KEY: "x" }, { emailConfigured: false }).enabled).toBe(false);
  });
  test("bad model lists are refused", () => {
    expect(() => aiConfigFrom({ AI_MODELS: '[{"id":"A b"}]' }, { emailConfigured: false })).toThrow();
    const twice = JSON.stringify([JSON.parse(MODELS)[0], JSON.parse(MODELS)[0]]);
    expect(() => aiConfigFrom({ AI_MODELS: twice }, { emailConfigured: false })).toThrow(/same id/);
  });
  test("confirmed email is asked for only when email can be sent", () => {
    expect(aiConfigFrom({}, { emailConfigured: true }).requireVerifiedEmail).toBe(true);
    expect(aiConfigFrom({}, { emailConfigured: false }).requireVerifiedEmail).toBe(false);
    expect(aiConfigFrom({ AI_REQUIRE_VERIFIED_EMAIL: "false" }, { emailConfigured: true }).requireVerifiedEmail).toBe(false);
  });
});

describe("money", () => {
  test("cost from tokens", () => {
    // 1M uncached input at $2, 100k output at $10, 1M cache reads at $0.10.
    expect(costUsd(standard.price, { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(3.1);
  });
  test("charged in millicredits, rounded up, with the model's rate", () => {
    expect(chargeFor(cfg, standard, 0.01)).toBe(1 * MILLI); // a cent is a credit
    expect(chargeFor(cfg, best, 0.01)).toBe(1.5 * MILLI);
    expect(chargeFor(cfg, standard, 0.0000001)).toBe(1);
  });
  test("a step's output is sized to what's left after its input", () => {
    // 10 credits; 20k input tokens at the cache-write rate ($2.50/M) = 5 credits.
    const out = affordableOutput(cfg, standard, 10 * MILLI, 20_000);
    expect(out).toBe(5000); // the other 5 credits buy 5000 tokens at $10/M
    // ...and what it may cost then fits in what was there.
    expect(chargeFor(cfg, standard, mostAStepCosts(standard, 20_000, out))).toBeLessThanOrEqual(10 * MILLI);
  });
  test("never more than the output limit, nothing when the input isn't covered", () => {
    expect(affordableOutput(cfg, standard, 1_000_000 * MILLI, 1000)).toBe(16000);
    expect(affordableOutput(cfg, standard, 1 * MILLI, 20_000)).toBe(0);
  });
});

describe("estimateTokens", () => {
  test("text at 2.5 characters a token, images at their most", () => {
    expect(estimateTokens("x".repeat(250))).toBe(100);
    const withImage = [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "A".repeat(1_000_000) } }, { type: "text", text: "hi" }] }];
    expect(estimateTokens(withImage)).toBeLessThan(2000);
  });
  test("an estimate is above a real count (about 4 characters a token)", () => {
    const text = "Move the sofa so it faces the window, and add a rug under it. ".repeat(50);
    expect(estimateTokens(text)).toBeGreaterThan(text.length / 4);
  });
});

describe("limits", () => {
  test("one reply at a time", () => {
    const limits = createAiLimits({ repliesPerMinute: 10, repliesPerDay: 100 });
    const a = limits.start("u", 0);
    expect(a.ok).toBe(true);
    expect(limits.start("u", 1)).toMatchObject({ ok: false, reason: "busy" });
    expect(limits.start("other", 1).ok).toBe(true);
    if (a.ok) a.done();
    expect(limits.start("u", 2).ok).toBe(true);
  });
  test("so many a minute and a day", () => {
    const limits = createAiLimits({ repliesPerMinute: 2, repliesPerDay: 3 });
    const run = (t: number) => {
      const r = limits.start("u", t);
      if (r.ok) r.done();
      return r;
    };
    expect(run(0).ok).toBe(true);
    expect(run(1000).ok).toBe(true);
    expect(run(2000)).toMatchObject({ ok: false, reason: "minute", retryAfter: 58 });
    expect(run(61_000).ok).toBe(true);
    expect(run(130_000)).toMatchObject({ ok: false, reason: "day" });
  });
});
