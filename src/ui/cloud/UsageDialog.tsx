// The account's Usage (account menu): its credits by kind, this month, what
// every reply of Odaja's AI cost, and where the credits came from. Free credits
// (starter, monthly, given) are spent before bought ones.
import { useEffect, useState, type ReactNode } from "react";
import { useCloudAi } from "../../cloud/ai";
import { fetchUsage, formatAmount, formatWhen, OUTCOME_LABEL, REASON_LABEL, type LedgerLine, type MyUsage, type ReplyLine } from "../../cloud/usage";
import { useOdaja } from "../../store";
import { Button } from "../primitives/Button";

export function UsageDialog() {
  const close = () => useOdaja.getState().openDialog(null);
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [tab, setTab] = useState<"replies" | "added">("replies");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const topUpUrl = useCloudAi((s) => s.status?.topUpUrl ?? null);

  useEffect(() => {
    fetchUsage()
      .then(setUsage)
      .catch((err) => setError((err as Error).message));
  }, []);

  const older = async () => {
    if (!usage) return;
    setLoadingMore(true);
    try {
      const page = await fetchUsage(usage.replies.at(-1)?.at);
      setUsage({ ...usage, replies: [...usage.replies, ...page.replies], more: page.more });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Usage" className="w-full max-w-[540px] h-[min(680px,86vh)] flex flex-col rounded-[14px] bg-card shadow-dialog border border-line text-ink overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-line">
          <div>
            <h2 className="font-serif text-2xl font-normal leading-none m-0">Usage</h2>
            <p className="mt-1.5 mb-0 text-xs text-muted">What Odaja's AI cost, and where your credits came from.</p>
          </div>
          <Button size="sm" onClick={close}>
            Close
          </Button>
        </div>

        {error && (
          <div role="alert" className="mx-5 mt-3 rounded-[6px] bg-danger-wash px-2.5 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        {!usage && !error && <div className="px-5 py-6 text-xs text-muted">Loading…</div>}

        {usage && (
          <>
            <div className="grid grid-cols-2 gap-2 px-5 pt-4">
              <Kind label="Free credits" value={usage.balance.free} hint="Starter, monthly and given credits. Spent first." />
              <Kind label="Bought credits" value={usage.balance.bought} hint="Top-ups you bought. They don't expire." />
            </div>
            <div className="px-5 pt-2.5 pb-3 text-[11.5px] text-ink-2 flex flex-wrap items-center gap-x-1.5">
              <span>
                This month: {usage.month.replies} {usage.month.replies === 1 ? "reply" : "replies"}, {formatAmount(usage.month.credits)} credits
                {usage.month.bought > 0 ? ` (${formatAmount(usage.month.bought)} of them bought)` : ""}.
              </span>
              {usage.balance.available < usage.balance.free + usage.balance.bought && <span className="text-muted">This month's limit leaves {formatAmount(usage.balance.available)} to spend.</span>}
              {topUpUrl && (
                <a href={topUpUrl} target="_blank" rel="noreferrer" className="text-accent-ink underline">
                  Buy credits
                </a>
              )}
            </div>

            <div role="tablist" className="flex gap-1 px-5 border-b border-line">
              <TabButton active={tab === "replies"} onClick={() => setTab("replies")}>
                Replies
              </TabButton>
              <TabButton active={tab === "added"} onClick={() => setTab("added")}>
                Credits added
              </TabButton>
            </div>

            <ul className="m-0 p-0 list-none overflow-y-auto px-3 py-2 min-h-[120px]">
              {tab === "replies" && usage.replies.length === 0 && <Empty>No replies from Odaja's AI yet.</Empty>}
              {tab === "replies" && usage.replies.map((r) => <Reply key={r.id} reply={r} />)}
              {tab === "replies" && usage.more && (
                <li className="flex justify-center py-2">
                  <Button size="sm" variant="ghost" disabled={loadingMore} onClick={older}>
                    {loadingMore ? "Loading…" : "Show older"}
                  </Button>
                </li>
              )}
              {tab === "added" && (usage.added ?? []).length === 0 && <Empty>No credits added yet.</Empty>}
              {tab === "added" && (usage.added ?? []).map((l) => <Added key={l.id} line={l} />)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Kind({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-paper px-3 py-2.5" title={hint}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-serif text-[26px] leading-tight tabular-nums">{formatAmount(value)}</div>
      <div className="text-[10.5px] text-faint leading-snug">{hint}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-0 border-b-2 bg-transparent px-2.5 py-2 text-xs cursor-pointer ${active ? "border-accent text-ink font-semibold" : "border-transparent text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <li className="px-2 py-5 text-xs text-muted">{children}</li>;

function Reply({ reply }: { reply: ReplyLine }) {
  const outcome = OUTCOME_LABEL[reply.outcome];
  return (
    <li className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 hover:bg-well">
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate">{reply.home?.name ?? "A deleted home"}</div>
        <div className="text-[11px] text-muted truncate">
          {formatWhen(reply.at)} · {reply.model} · {reply.steps} {reply.steps === 1 ? "step" : "steps"}
          {outcome ? ` · ${outcome}` : ""}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-semibold tabular-nums">−{formatAmount(reply.credits)}</div>
        {reply.bought > 0 && <div className="text-[10.5px] text-muted tabular-nums">{formatAmount(reply.bought)} bought</div>}
      </div>
    </li>
  );
}

function Added({ line }: { line: LedgerLine }) {
  const label = line.credits < 0 ? "Taken back" : REASON_LABEL[line.reason];
  return (
    <li className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 hover:bg-well">
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate">
          {label}
          {line.note ? <span className="font-normal text-ink-2"> · {line.note}</span> : null}
        </div>
        <div className="text-[11px] text-muted">{formatWhen(line.at)}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-xs font-semibold tabular-nums ${line.credits > 0 ? "text-ok" : "text-danger"}`}>
          {line.credits > 0 ? "+" : ""}
          {formatAmount(line.credits)}
        </div>
        <div className="text-[10.5px] text-muted tabular-nums">balance {formatAmount(line.balanceAfter)}</div>
      </div>
    </li>
  );
}
