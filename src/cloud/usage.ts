// What Odaja's AI cost: the account's Usage page, and the admin view for
// accounts in the server's ADMIN_EMAILS (backend/ai/usage.ts, backend/app.ts).
// Amounts are credits; the admin view also has our real cost in dollars.
import { useCloudAuth } from "./auth";

export type CreditReason = "starter" | "monthly" | "grant" | "top-up" | "ai";

export interface ReplyLine {
  id: string;
  at: number;
  home: { id: string; name: string } | null;
  model: string;
  steps: number;
  credits: number;
  // The part of `credits` paid with bought ones.
  bought: number;
  outcome: string;
}

export interface LedgerLine {
  id: string;
  at: number;
  reason: CreditReason;
  credits: number;
  bought: number;
  balanceAfter: number;
  note: string | null;
}

export interface Totals {
  replies: number;
  credits: number;
  bought: number;
  costUsd?: number;
  accounts?: number;
}

export interface MyUsage {
  balance: { available: number; free: number; bought: number };
  month: Totals;
  replies: ReplyLine[];
  // Only on the first page.
  added: LedgerLine[] | null;
  more: boolean;
}

export type Period = Totals & { period: string; costUsd: number; accounts: number };

export interface AdminReply extends ReplyLine {
  userId: string;
  email: string;
  costUsd: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface AdminOverview {
  period: "month" | "30-days";
  since: number;
  total: Totals & { costUsd: number; accounts: number };
  byDay: Period[];
  byMonth: Period[];
  accounts: (Totals & { id: string; email: string; name: string; costUsd: number; balance: { free: number; bought: number } })[];
  dearest: AdminReply[];
  given: { starter: number; monthly: number; grant: number; bought: number };
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  since: number;
  balance: { free: number; bought: number };
  byDay: Period[];
  byMonth: Period[];
  replies: AdminReply[];
  added: LedgerLine[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const base = useCloudAuth.getState().apiBase;
  const res = await fetch(`${base}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401) useCloudAuth.getState().handleUnauthorized();
  if (!res.ok || !json) throw new Error(json?.error ?? `The server answered ${res.status}.`);
  return json;
}

export const fetchUsage = (before?: number) => call<MyUsage>(`/ai/usage${before ? `?before=${before}` : ""}`);
export const fetchAdminUsage = (period: AdminOverview["period"]) => call<AdminOverview>(`/admin/usage?period=${period}`);
export const fetchAdminAccount = (id: string) => call<AdminAccount>(`/admin/accounts/${encodeURIComponent(id)}`);
export const adminGrant = (email: string, credits: number, note: string) => call<{ ok: true; id: string; balance: number }>("/admin/grant", { email, credits, note });

// Credits as people read them: up to two decimals, and "<0.01" for a crumb.
export function formatAmount(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.01) return n < 0 ? "−<0.01" : "<0.01";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 }).replace("-", "−");
}

export const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;

export const formatWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const REASON_LABEL: Record<CreditReason, string> = {
  starter: "Starter credits",
  monthly: "Monthly allowance",
  grant: "Given by Odaja",
  "top-up": "Bought",
  ai: "AI reply",
};

// How a reply ended, when it didn't simply finish.
export const OUTCOME_LABEL: Record<string, string> = {
  stopped: "Stopped",
  "no-credits": "Ran out of credits",
  steps: "Reached the step limit",
  refusal: "Declined",
  "max-tokens": "Cut off",
  error: "Failed",
};
