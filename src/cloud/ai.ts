// Odaja's own AI on the cloud server (backend/ai/): whether the server has it,
// its models, and the signed-in account's credits. The replies themselves go
// through the open cloud home (Platform.hostedAi, src/cloud/platform.ts).
import { create } from "zustand";
import { useCloudAuth } from "./auth";

export interface AiModelSummary {
  id: string;
  name: string;
  // Credits charged per credit of cost (top models cost more).
  rate: number;
  default: boolean;
}

export interface AiStatus {
  // Credits that can be spent now.
  balance: number;
  needsVerifiedEmail: boolean;
  // When more credits come (the monthly allowance, or the ceiling starting again; ms).
  nextAllowance: number | null;
  topUpUrl: string | null;
  // This account may open the admin view (the server checks every admin route).
  admin?: boolean;
}

interface CloudAiState {
  enabled: boolean;
  models: AiModelSummary[];
  status: AiStatus | null;
  // What the server offers (once); resolves when known.
  load(): Promise<void>;
  // The account's credits (signed in only).
  refresh(): Promise<AiStatus | null>;
  setBalance(balance: number): void;
}

let loading: Promise<void> | null = null;

export const useCloudAi = create<CloudAiState>((set, get) => ({
  enabled: false,
  models: [],
  status: null,

  load() {
    const base = useCloudAuth.getState().apiBase;
    if (!base) return Promise.resolve();
    loading ??= fetch(`${base}/api/v1/config`, { cache: "no-store" })
      .then((r) => r.json())
      .then((c: { ai?: { enabled?: boolean; models?: AiModelSummary[] } }) => set({ enabled: Boolean(c.ai?.enabled), models: c.ai?.models ?? [] }))
      .catch(() => {
        // The server isn't reachable now: ask again next time.
        loading = null;
      });
    return loading;
  },

  async refresh() {
    const { apiBase, status } = useCloudAuth.getState();
    await get().load();
    if (!apiBase || status !== "signed-in" || !get().enabled) {
      set({ status: null });
      return null;
    }
    try {
      const res = await fetch(`${apiBase}/api/v1/ai`, { credentials: "include", cache: "no-store" });
      if (!res.ok) return get().status;
      const body = (await res.json()) as { enabled: boolean } & AiStatus;
      set({ status: body.enabled ? body : null });
      return get().status;
    } catch {
      return get().status;
    }
  },

  setBalance(balance) {
    const status = get().status;
    if (status) set({ status: { ...status, balance } });
  },
}));

// Signing in or out changes whose credits these are.
useCloudAuth.subscribe((s, prev) => {
  if (s.status === prev.status) return;
  if (s.status === "signed-in") void useCloudAi.getState().refresh();
  else if (s.status === "signed-out") useCloudAi.setState({ status: null });
});

export const formatCredits = (n: number) => (n >= 100 ? Math.floor(n).toString() : (Math.floor(n * 10) / 10).toString());

export const formatDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long" });
