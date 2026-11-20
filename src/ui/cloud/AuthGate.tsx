import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCloudAuth } from "../../cloud/auth";
import { useOdaja } from "../../store";
import { LogoMark } from "../icons";

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

export function CloudAuthScreen() {
  const status = useCloudAuth((s) => s.status);
  const error = useCloudAuth((s) => s.error);
  const signIn = useCloudAuth((s) => s.signIn);
  const signUp = useCloudAuth((s) => s.signUp);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok =
        mode === "signin"
          ? await signIn(email.trim(), password)
          : await signUp(name.trim() || email.split("@")[0] || "Designer", email.trim(), password);
      if (ok) await useOdaja.getState().load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cloud-auth-page">
      <div className="cloud-auth-card">
        <div className="cloud-auth-brand">
          <LogoMark />
          <div>
            <h1>Odaja</h1>
            <p className="muted">Cloud studio for your 3D homes</p>
          </div>
        </div>

        <div className="cloud-auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={mode === "signin" ? "active" : ""}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "active" : ""}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        {status === "loading" ? (
          <div className="cloud-auth-loading muted">Checking your session…</div>
        ) : (
          <form className="cloud-auth-form" onSubmit={onSubmit}>
            {mode === "signup" && (
              <label className="field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Andrej"
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>Password</span>
              <div className="cloud-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="cloud-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            {error && <div className="cloud-auth-error" role="alert">{error}</div>}

            <button type="submit" className="primary cloud-auth-submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}

        <div className="cloud-auth-footer">
          <a href="?host=server">Use local folders instead</a>
        </div>
      </div>
    </div>
  );
}

export function CloudAccountButton() {
  const user = useCloudAuth((s) => s.user);
  const expiresAt = useCloudAuth((s) => s.expiresAt);
  const refresh = useCloudAuth((s) => s.refresh);
  const signOut = useCloudAuth((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const expiry = formatExpiry(expiresAt);

  return (
    <div className="cloud-account" ref={wrapRef}>
      <button
        type="button"
        className={`cloud-avatar-btn${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={`${user.name} (${user.email})`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {initials(user.name, user.email)}
      </button>

      {open && (
        <div className="cloud-user-menu" role="menu">
          <div className="cloud-user-head">
            <span className="cloud-avatar-lg">{initials(user.name, user.email)}</span>
            <div className="cloud-user-meta">
              <div className="cloud-user-name">{user.name}</div>
              <div className="cloud-user-email muted">{user.email}</div>
            </div>
          </div>

          <div className="cloud-user-status">
            <span className="cloud-status-dot" />
            <span>Cloud connected{expiry ? ` · until ${expiry}` : ""}</span>
          </div>

          <div className="cloud-user-actions">
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                await refresh();
                setRefreshed(true);
                setTimeout(() => setRefreshed(false), 1800);
              }}
            >
              {refreshed ? "Session refreshed ✓" : "Refresh session"}
            </button>
            <a href="?host=server" role="menuitem">
              Switch to local folders
            </a>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
