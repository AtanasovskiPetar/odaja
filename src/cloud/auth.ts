import { create } from "zustand";

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}

interface CloudAuthState {
  apiBase: string;
  status: "idle" | "loading" | "signed-out" | "signed-in";
  user: CloudUser | null;
  expiresAt: string | null;
  error: string | null;
  init(apiBase: string): Promise<CloudUser | null>;
  refresh(): Promise<CloudUser | null>;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(name: string, email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  handleUnauthorized(): void;
}

async function authFetch(base: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1/auth${path}`, {
    method: body !== undefined ? "POST" : "GET",
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // non-json response
  }
  return { ok: res.ok, status: res.status, json, text };
}

let listenersAttached = false;
function attachRefreshListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;
  let lastRefresh = Date.now();
  const maybeRefresh = () => {
    const s = useCloudAuth.getState();
    if (s.status !== "signed-in" || !s.apiBase) return;
    if (Date.now() - lastRefresh < 60_000) return;
    lastRefresh = Date.now();
    void s.refresh();
  };
  window.addEventListener("focus", maybeRefresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeRefresh();
  });
  // Periodic rolling session refresh every 10 minutes while tab stays open.
  window.setInterval(maybeRefresh, 10 * 60_000);
}

export const useCloudAuth = create<CloudAuthState>((set, get) => ({
  apiBase: "",
  status: "idle",
  user: null,
  expiresAt: null,
  error: null,

  async init(apiBase) {
    const clean = apiBase.replace(/\/+$/, "");
    set({ apiBase: clean, status: "loading", error: null });
    attachRefreshListeners();
    return get().refresh();
  },

  async refresh() {
    const { apiBase } = get();
    if (!apiBase) return null;
    try {
      const res = await authFetch(apiBase, "/get-session?disableCookieCache=true");
      const user = (res.json?.user as CloudUser | undefined) ?? null;
      const session = (res.json?.session as { expiresAt?: string } | undefined) ?? null;
      set({
        user,
        expiresAt: session?.expiresAt ?? null,
        status: user ? "signed-in" : "signed-out",
        ...(user ? { error: null } : {}),
      });
      return user;
    } catch {
      set({ user: null, expiresAt: null, status: "signed-out" });
      return null;
    }
  },

  async signIn(email, password) {
    const { apiBase } = get();
    set({ error: null });
    const res = await authFetch(apiBase, "/sign-in/email", { email, password, rememberMe: true });
    if (!res.ok) {
      set({ error: String(res.json?.message ?? res.json?.error ?? "Invalid email or password.") });
      return false;
    }
    const user = await get().refresh();
    return Boolean(user);
  },

  async signUp(name, email, password) {
    const { apiBase } = get();
    set({ error: null });
    const res = await authFetch(apiBase, "/sign-up/email", { name, email, password });
    if (!res.ok) {
      set({ error: String(res.json?.message ?? res.json?.error ?? "Could not create account.") });
      return false;
    }
    const user = await get().refresh();
    return Boolean(user);
  },

  async signOut() {
    const { apiBase } = get();
    await authFetch(apiBase, "/sign-out", {}).catch(() => {});
    set({ user: null, expiresAt: null, status: "signed-out", error: null });
  },

  handleUnauthorized() {
    set({ user: null, expiresAt: null, status: "signed-out", error: "Your session expired. Please sign in again." });
  },
}));
