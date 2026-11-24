import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatCredits, useCloudAi } from "../../cloud/ai";
import { useCloudAuth } from "../../cloud/auth";
import { mountTurnstile, type TurnstileWidget } from "../../cloud/turnstile";
import { useOdaja } from "../../store";
import { LogoMark } from "../icons";
import { Button } from "../primitives/Button";
import { TextField } from "../primitives/Input";
import { Popover } from "../primitives/Popover";

function initials(name: string, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The sign-in window, opened from the sidebar's account button (or when a
// session runs out). Nothing in the app needs it: local homes work without.
export function SignInWindow() {
  const win = useCloudAuth((s) => s.signInWindow);
  if (!win) return null;
  return <SignInForm key={win.mode} newPasswordToken={win.mode === "new-password" ? win.token : null} />;
}

type Mode = "signin" | "signup" | "forgot" | "sent-link" | "sent-reset" | "new-password" | "changed";

function SignInForm({ newPasswordToken }: { newPasswordToken: string | null }) {
  const auth = useCloudAuth();
  const methods = auth.methods;
  const [mode, setMode] = useState<Mode>(newPasswordToken ? "new-password" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => auth.openSignIn(null);

  // Turnstile, when the server checks for bots: asked right before making
  // an account or sending an email.
  const siteKey = methods?.turnstileSiteKey ?? null;
  const turnstileEl = useRef<HTMLDivElement>(null);
  const turnstile = useRef<Promise<TurnstileWidget> | null>(null);
  useEffect(() => {
    if (!siteKey || !turnstileEl.current) return;
    const widget = mountTurnstile(turnstileEl.current, siteKey);
    widget.catch(() => {});
    turnstile.current = widget;
    return () => {
      turnstile.current = null;
      void widget.then((w) => w.remove()).catch(() => {});
    };
  }, [siteKey]);
  // A token, or null (with the reason shown) when the check didn't pass.
  const captcha = async (): Promise<string | undefined | null> => {
    if (!siteKey) return undefined;
    try {
      if (!turnstile.current) throw new Error("The check that you're a person isn't ready. Try again.");
      return await (await turnstile.current).token();
    } catch (err) {
      useCloudAuth.setState({ error: (err as Error).message });
      return null;
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === "signin") await auth.signIn(email.trim(), password);
      else if (mode === "signup") {
        const token = await captcha();
        if (token !== null) await auth.signUp(name.trim() || email.split("@")[0] || "Designer", email.trim(), password, token);
      } else if (mode === "forgot") {
        const token = await captcha();
        if (token !== null && (await auth.requestReset(email.trim(), token))) setMode("sent-reset");
      } else if (mode === "new-password" && newPasswordToken) {
        if (await auth.resetPassword(newPasswordToken, password)) setMode("changed");
      }
    });
  };

  const emailLink = () =>
    run(async () => {
      if (!email.trim()) return useCloudAuth.setState({ error: "Enter your email first." });
      const token = await captcha();
      if (token !== null && (await auth.emailLink(email.trim(), token))) setMode("sent-link");
    });

  const title = { signin: "Sign in", signup: "Create an account", forgot: "Reset your password", "sent-link": "Check your email", "sent-reset": "Check your email", "new-password": "Choose a new password", changed: "Password changed" }[mode];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label={title} className="w-full max-w-[390px] rounded-[14px] bg-card p-7 shadow-dialog border border-line flex flex-col gap-5 text-ink">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div>
              <h1 className="font-serif text-[26px] font-normal leading-none tracking-tight m-0 text-ink">{title}</h1>
              <p className="mt-1 mb-0 text-xs text-muted">Your homes in your Odaja account, on any computer.</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="border-0 bg-transparent text-muted hover:text-ink cursor-pointer text-lg leading-none">×</button>
        </div>

        {(mode === "signin" || mode === "signup") && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-[8px] bg-well" role="tablist">
            {(["signin", "signup"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mode === tab}
                onClick={() => (setMode(tab), useCloudAuth.setState({ error: null }))}
                className={`h-7 rounded-[6px] text-xs font-medium border-0 cursor-pointer transition-colors ${mode === tab ? "bg-card text-ink shadow-card" : "bg-transparent text-ink-2 hover:text-ink"}`}
              >
                {tab === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
        )}

        {mode === "sent-link" || mode === "sent-reset" ? (
          <p className="m-0 text-xs text-ink-2 leading-relaxed">
            {mode === "sent-link" ? "We sent a sign-in link" : "We sent a link to choose a new password"} to <strong>{email}</strong>. Open it on this computer; you can close this window.
          </p>
        ) : mode === "changed" ? (
          <>
            <p className="m-0 text-xs text-ink-2">Your new password is set. Sign in with it.</p>
            <Button variant="primary" onClick={() => setMode("signin")}>Sign in</Button>
          </>
        ) : (
          <form className="flex flex-col gap-3.5" onSubmit={onSubmit}>
            {mode === "signup" && <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Andrej" autoComplete="name" required />}
            {mode !== "new-password" && (
              <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required autoFocus />
            )}
            {mode !== "forgot" && (
              <TextField
                label={mode === "new-password" ? "New password" : "Password"}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signin" ? "Your password" : "At least 8 characters"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={8}
                required
                autoFocus={mode === "new-password"}
              />
            )}

            {auth.error && (
              <div role="alert" className="rounded-[6px] bg-danger-wash px-2.5 py-2 text-xs text-danger">
                {auth.error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full mt-0.5">
              {busy ? "Please wait…" : { signin: "Sign in", signup: "Create account", forgot: "Email me a link", "new-password": "Set the password" }[mode as "signin"]}
            </Button>

            {mode === "signin" && methods?.resetPassword && (
              <button type="button" onClick={() => setMode("forgot")} className="self-center border-0 bg-transparent text-[11px] text-muted hover:text-ink cursor-pointer">
                Forgot your password?
              </button>
            )}
            {mode === "forgot" && (
              <button type="button" onClick={() => setMode("signin")} className="self-center border-0 bg-transparent text-[11px] text-muted hover:text-ink cursor-pointer">
                Back to sign in
              </button>
            )}
          </form>
        )}

        {(mode === "signin" || mode === "signup") && (methods?.emailLink || methods?.google || methods?.github) && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            {methods.emailLink && (
              <Button disabled={busy} onClick={emailLink}>
                Email me a sign-in link
              </Button>
            )}
            {methods.google && <Button disabled={busy} onClick={() => run(() => auth.social("google"))}>Continue with Google</Button>}
            {methods.github && <Button disabled={busy} onClick={() => run(() => auth.social("github"))}>Continue with GitHub</Button>}
          </div>
        )}

        {/* Turnstile's box, shown only when Cloudflare wants a tick. */}
        {siteKey && <div ref={turnstileEl} className="empty:hidden" />}
      </div>
    </div>
  );
}

const MENU_ITEM = "w-full text-left border-0 bg-transparent text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well cursor-pointer";

export function CloudAccountFooter() {
  const user = useCloudAuth((s) => s.user);
  const expiresAt = useCloudAuth((s) => s.expiresAt);
  const refresh = useCloudAuth((s) => s.refresh);
  const signOut = useCloudAuth((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const aiStatus = useCloudAi((s) => s.status);
  const show = (kind: "usage" | "admin") => {
    setOpen(false);
    useOdaja.getState().openDialog({ kind });
  };

  if (!user) {
    return (
      <div className="shrink-0 border-t border-line bg-sheet px-2.5 py-2">
        <button
          type="button"
          onClick={() => useCloudAuth.getState().openSignIn({ mode: "sign-in" })}
          className="w-full flex items-center gap-2.5 rounded-[8px] border-0 px-2 py-1.5 text-left cursor-pointer bg-transparent hover:bg-well"
        >
          <span className="w-7 h-7 rounded-full bg-well border border-line text-muted text-[13px] inline-flex items-center justify-center shrink-0">☁</span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-ink leading-tight">Sign in</div>
            <div className="text-[11px] text-muted truncate leading-tight mt-0.5">Keep homes in your account</div>
          </div>
        </button>
      </div>
    );
  }
  const expiry = formatExpiry(expiresAt);
  const badge = initials(user.name, user.email);

  return (
    <div className="shrink-0 border-t border-line bg-sheet px-2.5 py-2">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${user.name} (${user.email})`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`w-full flex items-center gap-2.5 rounded-[8px] border-0 px-2 py-1.5 text-left cursor-pointer transition-colors ${
          open ? "bg-well" : "bg-transparent hover:bg-well"
        }`}
      >
        <span className="w-7 h-7 rounded-full bg-accent-wash text-accent-ink border border-accent-line text-[11px] font-semibold inline-flex items-center justify-center shrink-0">
          {badge}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-ink truncate leading-tight">{user.name}</div>
          <div className="text-[11px] text-muted truncate leading-tight mt-0.5">{user.email}</div>
        </div>
        <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" title="Cloud connected" />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} align="start" placement="top" width={248}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 px-1">
            <span className="w-8 h-8 rounded-full bg-accent-wash text-accent-ink border border-accent-line text-xs font-semibold inline-flex items-center justify-center shrink-0">
              {badge}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-ink truncate">{user.name}</div>
              <div className="text-[11px] text-muted truncate">{user.email}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-[6px] bg-well px-2.5 py-1.5 text-[11px] text-ink-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
            <span className="truncate">Cloud connected{expiry ? ` · until ${expiry}` : ""}</span>
          </div>

          <div className="flex flex-col gap-0.5 border-t border-line pt-1.5">
            {aiStatus && (
              <button type="button" role="menuitem" onClick={() => show("usage")} className={MENU_ITEM}>
                Usage <span className="text-muted">· {formatCredits(aiStatus.balance)} credits</span>
              </button>
            )}
            {aiStatus?.admin && (
              <button type="button" role="menuitem" onClick={() => show("admin")} className={MENU_ITEM}>
                Admin
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                await refresh();
                setRefreshed(true);
                setTimeout(() => setRefreshed(false), 1800);
              }}
              className={MENU_ITEM}
            >
              {refreshed ? "Session refreshed ✓" : "Refresh session"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
              className="w-full text-left border-0 bg-transparent text-danger text-xs px-2 py-1.5 rounded-[6px] hover:bg-danger-wash cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
