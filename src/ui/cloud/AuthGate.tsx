import { useRef, useState, type FormEvent } from "react";
import { useCloudAuth } from "../../cloud/auth";
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

export function CloudAuthScreen() {
  const status = useCloudAuth((s) => s.status);
  const error = useCloudAuth((s) => s.error);
  const signIn = useCloudAuth((s) => s.signIn);
  const signUp = useCloudAuth((s) => s.signUp);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="min-h-screen flex items-center justify-center p-6 bg-paper text-ink">
      <div className="w-full max-w-[390px] rounded-[14px] bg-card p-7 shadow-dialog border border-line flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="font-serif text-[28px] font-normal leading-none tracking-tight m-0 text-ink">
              Odaja
            </h1>
            <p className="mt-1 mb-0 text-xs text-muted">Cloud studio for your 3D homes</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-[8px] bg-well" role="tablist">
          {(["signin", "signup"] as const).map((tab) => {
            const active = mode === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(tab)}
                className={`h-7 rounded-[6px] text-xs font-medium border-0 cursor-pointer transition-colors ${
                  active ? "bg-card text-ink shadow-card" : "bg-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {tab === "signin" ? "Sign in" : "Create account"}
              </button>
            );
          })}
        </div>

        {status === "loading" ? (
          <div className="py-6 text-center text-xs text-muted">Checking your session…</div>
        ) : (
          <form className="flex flex-col gap-3.5" onSubmit={onSubmit}>
            {mode === "signup" && (
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Andrej"
                autoComplete="name"
                required
              />
            )}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              autoFocus
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={8}
              required
            />

            {error && (
              <div role="alert" className="rounded-[6px] bg-danger-wash px-2.5 py-2 text-xs text-danger">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full mt-0.5">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        )}

        <div className="border-t border-line pt-3 text-center text-xs">
          <a href="?host=server" className="text-muted hover:text-ink no-underline hover:underline">
            Use local folders instead
          </a>
        </div>
      </div>
    </div>
  );
}

export function CloudAccountFooter() {
  const user = useCloudAuth((s) => s.user);
  const expiresAt = useCloudAuth((s) => s.expiresAt);
  const refresh = useCloudAuth((s) => s.refresh);
  const signOut = useCloudAuth((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!user) return null;
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
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                await refresh();
                setRefreshed(true);
                setTimeout(() => setRefreshed(false), 1800);
              }}
              className="w-full text-left border-0 bg-transparent text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well cursor-pointer"
            >
              {refreshed ? "Session refreshed ✓" : "Refresh session"}
            </button>
            <a
              href="?host=server"
              role="menuitem"
              className="w-full text-left text-ink text-xs px-2 py-1.5 rounded-[6px] hover:bg-well no-underline block"
            >
              Switch to local folders
            </a>
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
