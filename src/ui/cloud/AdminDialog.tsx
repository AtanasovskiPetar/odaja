// The admin view (account menu, for accounts in the server's ADMIN_EMAILS):
// what Odaja's AI is used for and what it really costs us, by day and month;
// the accounts and replies that cost most; free credits given against bought;
// one account in detail; and giving credits by hand. Every route behind it is
// checked on the server; this is only how it's shown.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  adminGrant,
  fetchAdminAccount,
  fetchAdminUsage,
  formatAmount,
  formatUsd,
  formatWhen,
  OUTCOME_LABEL,
  REASON_LABEL,
  type AdminAccount,
  type AdminOverview,
  type AdminReply,
  type Period,
} from "../../cloud/usage";
import { useOdaja } from "../../store";
import { Button } from "../primitives/Button";

export function AdminDialog() {
  const close = () => useOdaja.getState().openDialog(null);
  const [period, setPeriod] = useState<AdminOverview["period"]>("month");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const body = useRef<HTMLDivElement>(null);
  // Another account, or back to all: from the top.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [account?.id]);

  const load = (p = period) =>
    fetchAdminUsage(p)
      .then((o) => {
        setOverview(o);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  useEffect(() => {
    void load(period);
  }, [period]);

  const open = (id: string) =>
    fetchAdminAccount(id)
      .then((a) => {
        setAccount(a);
        setGrantEmail(a.email);
      })
      .catch((err) => setError((err as Error).message));

  // After giving credits: the numbers shown again, with them in.
  const granted = (id: string) => {
    void load();
    if (account?.id === id) void open(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Admin" className="w-full max-w-[960px] max-h-[90vh] flex flex-col rounded-[14px] bg-card shadow-dialog border border-line text-ink overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl font-normal leading-none m-0">{account ? account.email : "Odaja's AI: usage"}</h2>
            <p className="mt-1.5 mb-0 text-xs text-muted">
              {account ? `${account.name} · account since ${new Date(account.since).toLocaleDateString()}` : "Every account's spend and what it really cost us. Only admins see this."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {account ? (
              <Button size="sm" onClick={() => setAccount(null)}>
                ← All accounts
              </Button>
            ) : (
              <div role="tablist" className="flex rounded-[7px] border border-line bg-well p-0.5">
                <Segment active={period === "month"} onClick={() => setPeriod("month")}>
                  This month
                </Segment>
                <Segment active={period === "30-days"} onClick={() => setPeriod("30-days")}>
                  Last 30 days
                </Segment>
              </div>
            )}
            <Button size="sm" onClick={close}>
              Close
            </Button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mx-5 mt-3 rounded-[6px] bg-danger-wash px-2.5 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div ref={body} className="overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {!overview && !error && <div className="text-xs text-muted">Loading…</div>}
          {account ? <AccountView account={account} /> : overview && <OverviewView overview={overview} open={open} />}
          <GrantForm email={grantEmail} setEmail={setGrantEmail} onGranted={granted} />
        </div>
      </div>
    </div>
  );
}

function OverviewView({ overview, open }: { overview: AdminOverview; open: (id: string) => void }) {
  const { total, given } = overview;
  const free = given.starter + given.monthly + given.grant;
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile label="Replies" value={total.replies.toLocaleString()} />
        <Tile label="Accounts using AI" value={total.accounts.toLocaleString()} />
        <Tile label="Credits spent" value={formatAmount(total.credits)} sub={total.bought ? `${formatAmount(total.bought)} bought` : undefined} />
        <Tile label="Our real cost" value={formatUsd(total.costUsd)} />
        <Tile label="Free credits given" value={formatAmount(free)} sub={`starter ${formatAmount(given.starter)} · monthly ${formatAmount(given.monthly)} · by hand ${formatAmount(given.grant)}`} />
        <Tile label="Credits bought" value={formatAmount(given.bought)} />
      </div>

      <SeriesTables byDay={overview.byDay} byMonth={overview.byMonth} />

      <Section title="Accounts that cost most" note={overview.accounts.length ? "Click one for its days, months, replies and credits." : undefined}>
        {overview.accounts.length === 0 ? (
          <Empty>No replies in this period.</Empty>
        ) : (
          <Table head={["Account", "Replies", "Credits", "Our cost", "Balance (free / bought)"]} align={["left", "right", "right", "right", "right"]}>
            {overview.accounts.map((a) => (
              <tr key={a.id} onClick={() => open(a.id)} className="cursor-pointer hover:bg-well">
                <Td>
                  <div className="font-semibold truncate max-w-[280px]">{a.email}</div>
                  <div className="text-[10.5px] text-muted truncate max-w-[280px]">{a.name}</div>
                </Td>
                <Td right>{a.replies}</Td>
                <Td right>
                  {formatAmount(a.credits)}
                  {a.bought > 0 && <div className="text-[10.5px] text-muted">{formatAmount(a.bought)} bought</div>}
                </Td>
                <Td right>{formatUsd(a.costUsd)}</Td>
                <Td right>
                  {formatAmount(a.balance.free)} / {formatAmount(a.balance.bought)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Replies that cost most">
        <Replies replies={overview.dearest} withEmail open={open} />
      </Section>
    </>
  );
}

function AccountView({ account }: { account: AdminAccount }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Free credits" value={formatAmount(account.balance.free)} />
        <Tile label="Bought credits" value={formatAmount(account.balance.bought)} />
        <Tile label="Replies (12 months)" value={account.byMonth.reduce((n, p) => n + p.replies, 0).toLocaleString()} />
        <Tile label="Our cost (12 months)" value={formatUsd(account.byMonth.reduce((n, p) => n + p.costUsd, 0))} />
      </div>
      <SeriesTables byDay={account.byDay} byMonth={account.byMonth} perAccount />
      <Section title="Latest replies">
        <Replies replies={account.replies} />
      </Section>
      <Section title="Credits added">
        {account.added.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <Table head={["When", "What", "Credits", "Balance after"]} align={["left", "left", "right", "right"]}>
            {account.added.map((l) => (
              <tr key={l.id}>
                <Td>{formatWhen(l.at)}</Td>
                <Td>
                  {l.credits < 0 ? "Taken back" : REASON_LABEL[l.reason]}
                  {l.note && <span className="text-muted"> · {l.note}</span>}
                </Td>
                <Td right>
                  {l.credits > 0 ? "+" : ""}
                  {formatAmount(l.credits)}
                </Td>
                <Td right>{formatAmount(l.balanceAfter)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

// By day (the last 30) or by month (the last 12), with our cost as a bar.
function SeriesTables({ byDay, byMonth, perAccount }: { byDay: Period[]; byMonth: Period[]; perAccount?: boolean }) {
  const [unit, setUnit] = useState<"day" | "month">("day");
  const rows = [...(unit === "day" ? byDay : byMonth)].reverse();
  const most = Math.max(0.000001, ...rows.map((r) => r.costUsd));
  return (
    <Section
      title={unit === "day" ? "By day (last 30)" : "By month (last 12)"}
      action={
        <div role="tablist" className="flex rounded-[7px] border border-line bg-well p-0.5">
          <Segment active={unit === "day"} onClick={() => setUnit("day")}>
            Days
          </Segment>
          <Segment active={unit === "month"} onClick={() => setUnit("month")}>
            Months
          </Segment>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty>No replies yet.</Empty>
      ) : (
        <Table
          head={[unit === "day" ? "Day" : "Month", "Replies", ...(perAccount ? [] : ["Accounts"]), "Credits", "Our cost", ""]}
          align={["left", "right", ...(perAccount ? [] : ["right" as const]), "right", "right", "left"]}
          tall
        >
          {rows.map((r) => (
            <tr key={r.period}>
              <Td>{r.period}</Td>
              <Td right>{r.replies}</Td>
              {!perAccount && <Td right>{r.accounts}</Td>}
              <Td right>
                {formatAmount(r.credits)}
                {r.bought > 0 && <span className="text-muted"> ({formatAmount(r.bought)} bought)</span>}
              </Td>
              <Td right>{formatUsd(r.costUsd)}</Td>
              <Td>
                <div className="h-2 w-[140px] rounded-full bg-well overflow-hidden" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (r.costUsd / most) * 100)}%` }} />
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function Replies({ replies, withEmail, open }: { replies: AdminReply[]; withEmail?: boolean; open?: (id: string) => void }) {
  if (replies.length === 0) return <Empty>No replies yet.</Empty>;
  return (
    <Table
      head={["When", ...(withEmail ? ["Account"] : []), "Home", "Model", "Steps", "Tokens in / out", "Our cost", "Credits"]}
      align={["left", ...(withEmail ? ["left" as const] : []), "left", "left", "right", "right", "right", "right"]}
    >
      {replies.map((r) => {
        const input = r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite;
        return (
          <tr key={r.id}>
            <Td>{formatWhen(r.at)}</Td>
            {withEmail && (
              <Td>
                <button type="button" onClick={() => open?.(r.userId)} className="border-0 bg-transparent p-0 text-left text-accent-ink underline cursor-pointer truncate max-w-[200px] text-[11.5px]">
                  {r.email}
                </button>
              </Td>
            )}
            <Td>
              <span className="truncate inline-block max-w-[160px] align-bottom">{r.home?.name ?? "—"}</span>
            </Td>
            <Td>
              {r.model}
              {OUTCOME_LABEL[r.outcome] && <div className="text-[10.5px] text-muted">{OUTCOME_LABEL[r.outcome]}</div>}
            </Td>
            <Td right>{r.steps}</Td>
            <Td right>
              <span title={`${r.tokens.cacheRead.toLocaleString()} read from cache, ${r.tokens.cacheWrite.toLocaleString()} written to it`}>
                {input.toLocaleString()} / {r.tokens.output.toLocaleString()}
              </span>
            </Td>
            <Td right>{formatUsd(r.costUsd)}</Td>
            <Td right>{formatAmount(r.credits)}</Td>
          </tr>
        );
      })}
    </Table>
  );
}

function GrantForm({ email, setEmail, onGranted }: { email: string; setEmail: (v: string) => void; onGranted: (id: string) => void }) {
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const amount = Number(credits);
  const valid = email.trim() !== "" && Number.isFinite(amount) && amount !== 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await adminGrant(email.trim(), amount, note);
      setResult({ ok: true, text: `${amount > 0 ? "Gave" : "Took back"} ${formatAmount(Math.abs(amount))} credits. Balance now ${formatAmount(r.balance)}.` });
      setCredits("");
      setNote("");
      onGranted(r.id);
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const field = "h-8 min-w-0 rounded-[7px] border border-line bg-paper px-2.5 text-xs text-ink";
  return (
    <Section title="Give credits" note="Free credits, by hand (early supporters, support). A negative number takes free credits back.">
      <form onSubmit={submit} className="flex flex-wrap gap-2 items-center">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" className={`${field} flex-[2_1_200px]`} aria-label="Email address" />
        <input value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="Credits" inputMode="decimal" className={`${field} w-[90px]`} aria-label="Credits" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, shown to them (optional)" maxLength={200} className={`${field} flex-[3_1_200px]`} aria-label="Note" />
        <Button size="sm" variant="primary" type="submit" disabled={!valid || busy}>
          {busy ? "Giving…" : "Give"}
        </Button>
      </form>
      {result && <div className={`mt-2 text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.text}</div>}
    </Section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-paper px-3 py-2.5 min-w-0">
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="font-serif text-[22px] leading-tight tabular-nums truncate">{value}</div>
      {sub && <div className="text-[10.5px] text-faint leading-snug">{sub}</div>}
    </div>
  );
}

function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-2">
        <div>
          <h3 className="m-0 text-[13px] font-semibold">{title}</h3>
          {note && <p className="m-0 mt-0.5 text-[11px] text-muted">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// `tall`: a long list scrolls inside its own box, under a header that stays.
function Table({ head, align, tall, children }: { head: string[]; align: ("left" | "right")[]; tall?: boolean; children: ReactNode }) {
  return (
    <div className={`overflow-x-auto rounded-[10px] border border-line ${tall ? "max-h-[272px] overflow-y-auto" : ""}`}>
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-well text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`px-2.5 py-1.5 font-medium whitespace-nowrap ${align[i] === "right" ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line">{children}</tbody>
      </table>
    </div>
  );
}

const Td = ({ children, right }: { children: ReactNode; right?: boolean }) => <td className={`px-2.5 py-1.5 align-top tabular-nums ${right ? "text-right" : ""}`}>{children}</td>;

const Empty = ({ children }: { children: ReactNode }) => <div className="text-xs text-muted py-2">{children}</div>;

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-0 rounded-[5px] px-2.5 py-1 text-[11.5px] cursor-pointer ${active ? "bg-card text-ink font-semibold shadow-card" : "bg-transparent text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
