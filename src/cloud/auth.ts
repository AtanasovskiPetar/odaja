import { create } from "zustand";

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}

export interface SignInMethods {
  password: boolean;
  emailLink: boolean;
  resetPassword: boolean;
  google: boolean;
  github: boolean;
  // Turnstile's public key when the server checks for bots (src/cloud/turnstile.ts).
  turnstileSiteKey?: string | null;
}

// Where links from emails and Google/GitHub bring you back: this page.
const here = () => location.origin + location.pathname;

const message = (res: { json: Record<string, unknown> | null }, fallback: string) => String(res.json?.message ?? res.json?.error ?? fallback);

interface CloudAuthState {
  apiBase: string;
  status: "idle" | "loading" | "signed-out" | "signed-in";
  user: CloudUser | null;
  expiresAt: string | null;
  error: string | null;
  init(apiBase: string): Promise<CloudUser | null>;
  refresh(): Promise<CloudUser | null>;
  signIn(email: string, password: string): Promise<boolean>;
  // `captcha`: a Turnstile token, when the server asks for one.
  signUp(name: string, email: string, password: string, captcha?: string): Promise<boolean>;
  signOut(): Promise<void>;
  // What the server offers (password always; the rest when configured).
  methods: SignInMethods | null;
  // The sign-in window: closed, signing in, or choosing a new password
  // (from a reset email's link, with its token).
  signInWindow: null | { mode: "sign-in" } | { mode: "new-password"; token: string };
  openSignIn(w: CloudAuthState["signInWindow"]): void;
  emailLink(email: string, captcha?: string): Promise<boolean>;
  social(provider: "google" | "github"): Promise<void>;
  requestReset(email: string, captcha?: string): Promise<boolean>;
  // Send the email confirming the signed-in account's address again.
  resendVerification(): Promise<boolean>;
  resetPassword(token: string, password: string): Promise<boolean>;
  handleUnauthorized(): void;
}

async function authFetch(base: string, path: string, body?: unknown, captcha?: string) {
  const res = await fetch(`${base}/api/v1/auth${path}`, {
    method: body !== undefined ? "POST" : "GET",
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json", ...(captcha ? { "x-captcha-response": captcha } : {}) } : undefined,
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
  methods: null,
  signInWindow: null,
  openSignIn: (w) => set({ signInWindow: w, error: null }),

  async init(apiBase) {
    const clean = apiBase.replace(/\/+$/, "");
    set({ apiBase: clean, status: "loading", error: null });
    attachRefreshListeners();
    // Back from a password-reset email: choose the new password.
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    if (params.has("reset-password") && token) {
      history.replaceState(null, "", here());
      set({ signInWindow: { mode: "new-password", token } });
    }
    fetch(`${clean}/api/v1/config`, { cache: "no-store" })
      .then((r) => r.json())
      .then((c: { signIn?: SignInMethods }) => set({ methods: c.signIn ?? null }))
      .catch(() => {});
    return get().refresh();
  },

  async emailLink(email, captcha) {
    set({ error: null });
    const res = await authFetch(get().apiBase, "/sign-in/magic-link", { email, callbackURL: here() }, captcha);
    if (!res.ok) set({ error: message(res, "Couldn't send the link.") });
    return res.ok;
  },

  async social(provider) {
    set({ error: null });
    const res = await authFetch(get().apiBase, "/sign-in/social", { provider, callbackURL: here() });
    const url = res.json?.url;
    if (res.ok && typeof url === "string") location.href = url;
    else set({ error: message(res, `Couldn't sign in with ${provider === "google" ? "Google" : "GitHub"}.`) });
  },

  async requestReset(email, captcha) {
    set({ error: null });
    // The email's link comes back here with ?token=…&reset-password.
    const res = await authFetch(get().apiBase, "/request-password-reset", { email, redirectTo: `${here()}?reset-password` }, captcha);
    if (!res.ok) set({ error: message(res, "Couldn't send the email.") });
    return res.ok;
  },

  async resendVerification() {
    const { apiBase, user } = get();
    if (!user) return false;
    return (await authFetch(apiBase, "/send-verification-email", { email: user.email, callbackURL: here() }).catch(() => null))?.ok ?? false;
  },

  async resetPassword(token, password) {
    set({ error: null });
    const res = await authFetch(get().apiBase, "/reset-password", { token, newPassword: password });
    if (!res.ok) set({ error: message(res, "Couldn't change the password. The link may have expired.") });
    return res.ok;
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
      // No connection: that says nothing about the session. Signed in stays
      // signed in (an account home keeps its changes until it's back).
      if (get().status === "signed-in") return get().user;
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
    if (user) set({ signInWindow: null });
    return Boolean(user);
  },

  async signUp(name, email, password, captcha) {
    const { apiBase } = get();
    set({ error: null });
    const res = await authFetch(apiBase, "/sign-up/email", { name, email, password }, captcha);
    if (!res.ok) {
      set({ error: String(res.json?.message ?? res.json?.error ?? "Could not create account.") });
      return false;
    }
    const user = await get().refresh();
    if (user) set({ signInWindow: null });
    return Boolean(user);
  },

  async signOut() {
    const { apiBase } = get();
    await authFetch(apiBase, "/sign-out", {}).catch(() => {});
    set({ user: null, expiresAt: null, status: "signed-out", error: null });
  },

  handleUnauthorized() {
    set({ user: null, expiresAt: null, status: "signed-out", signInWindow: { mode: "sign-in" }, error: "Your session expired. Please sign in again." });
  },
}));

// Signed in to a cloud server (false when none is configured).
export const useCloudSignedIn = () => useCloudAuth((s) => s.status === "signed-in");
