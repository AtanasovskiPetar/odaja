// The prompt-first start (docs/cloud-plan.md, "The first screen"): describe
// the home or drop in a floor plan, and the AI builds it while you watch.
//   - With Odaja's own AI (a cloud server that has it): the home is made in
//     the account. Pressing Send signed out opens the sign-in; the prompt and
//     its images are kept through it (also across Google/GitHub's redirect)
//     and the build starts as soon as you're in.
//   - With a key or model of your own already set up: a home here (browser or
//     folder), built with it.
//   - Neither: a home here, the chat open with the prompt, and the settings
//     to add a key ("Use your own API key"; in the companion with Claude
//     Code signed in, "Use Claude Code or your own key", which uses it).
// "Start without AI" shows the usual ways to start a home.
import { useEffect, useRef, useState } from "react";
import { useCloudAi } from "../cloud/ai";
import { useCloudAuth, useCloudSignedIn } from "../cloud/auth";
import { useOdaja } from "../store";
import { useChat } from "./chat/chatStore";
import { IconArrowUp, IconClip, IconClose } from "./icons";
import { PLAN_DRAFT } from "./NewHome";
import { blobToBase64, PLAN_ACCEPT } from "./planImage";
import { Button } from "./primitives/Button";

// Short enough to stay on one line on a phone.
const EXAMPLES = ["A two-bedroom flat, 65 m², open kitchen", "A 4 × 5 m living room facing the TV", "A 30 m² studio with a sleeping nook"];

const PENDING_KEY = "odaja:pending-prompt";
// Images kept through a sign-in redirect only up to this much (sessionStorage is small).
const MAX_KEPT = 3_500_000;

interface Pending {
  text: string;
  files: File[];
}

// The prompt waiting for the sign-in, in memory and (for redirects) in this tab's storage.
let pending: Pending | null = null;

async function keep(p: Pending) {
  pending = p;
  try {
    const images = await Promise.all(p.files.map(async (f) => ({ name: f.name, type: f.type, url: `data:${f.type};base64,${await blobToBase64(f)}` })));
    const size = images.reduce((n, i) => n + i.url.length, 0);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ text: p.text, images: size <= MAX_KEPT ? images : [] }));
  } catch {
    // Storage full or unavailable: kept in memory only.
  }
}

async function takeKept(): Promise<Pending | null> {
  const mine = pending;
  pending = null;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
  if (mine) return mine;
  if (!stored) return null;
  try {
    const { text, images } = JSON.parse(stored) as { text: string; images: { name: string; type: string; url: string }[] };
    const files = await Promise.all(images.map(async (i) => new File([await (await fetch(i.url)).blob()], i.name, { type: i.type })));
    return { text, files };
  } catch {
    return null;
  }
}

// A name for the home from the first words of the prompt.
export function homeNameFrom(prompt: string): string {
  const first = prompt === PLAN_DRAFT ? "" : (prompt.split(/[.\n!?;]/)[0] ?? "").trim();
  if (!first) return "New home";
  let name = first;
  if (name.length > 40) name = name.slice(0, 40).replace(/[\s,]+\S*$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Floor plans as PDFs become images the model can see (their first page).
async function asImage(file: File): Promise<File> {
  if (file.type.startsWith("image/")) return file;
  const { loadPlanFile } = await import("./planImage");
  const { blob } = await loadPlanFile(file);
  return new File([blob], file.name.replace(/\.pdf$/i, ".png"), { type: blob.type });
}

type How = "auto" | "own-key";

// Start a home from the prompt. Returns "sign-in" when it waits for one.
async function begin(text: string, files: File[], how: How): Promise<"started" | "sign-in"> {
  // A prompt kept for an earlier sign-in is replaced by this one (or by
  // starting another way), so it never builds later by surprise.
  await takeKept();
  const chat = useChat.getState();
  await chat.loadProviders();
  const prompt = text.trim() || (files.length ? PLAN_DRAFT : "");
  const providers = useChat.getState().providers;
  const current = providers.find((p) => p.id === useChat.getState().provider && p.ready);
  const own = providers.find((p) => p.ready && p.kind !== "credits");
  const ours = providers.find((p) => p.id === "odaja");

  // The model already chosen, else Odaja's AI, else a key of your own.
  const use = how === "own-key" ? own : (current ?? ours ?? own);
  if (use?.id === "odaja" && !use.ready) {
    await keep({ text, files });
    useCloudAuth.getState().openSignIn({ mode: "sign-in" });
    return "sign-in";
  }

  const name = homeNameFrom(prompt);
  if (!use) {
    // No AI yet: the home, the prompt in the chat, and where to add a key.
    await useOdaja.getState().createProject(name, undefined, false);
    chat.startDraft(prompt, files);
    chat.setSettingsOpen(true);
    return "started";
  }
  await useOdaja.getState().createProject(name, undefined, use.id === "odaja");
  if (useChat.getState().provider !== use.id) await useChat.getState().selectProvider(use.id);
  // Sent as soon as the chat opens on the new home (an empty prompt waits there).
  useChat.getState().startDraft(prompt, files, Boolean(prompt));
  return "started";
}

export function PromptStart({ onStartWithoutAi }: { onStartWithoutAi: () => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiEnabled = useCloudAi((s) => s.enabled);
  const signedIn = useCloudSignedIn();
  const signInOpen = useCloudAuth((s) => s.signInWindow !== null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // In the companion, "your own" can be your Claude Code subscription.
  const [claudeCode, setClaudeCode] = useState(false);

  useEffect(() => {
    void useCloudAi.getState().load();
    void import("../agent/chat/models").then(({ claudeCode }) => claudeCode()).then((cc) => setClaudeCode(Boolean(cc?.ready)), () => {});
  }, []);

  const run = async (how: How, t = text, f = files.map((x) => x.file)) => {
    setBusy(true);
    setError(null);
    try {
      const result = await begin(t, f, how);
      setWaiting(result === "sign-in");
      if (result === "sign-in") setBusy(false);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // Signed in with a prompt waiting (also after Google/GitHub sent you back): go on.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void takeKept().then((kept) => {
      if (!kept || cancelled) return;
      setText(kept.text);
      void run("auto", kept.text, kept.files);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // The sign-in closed without signing in: the prompt stays in the box.
  useEffect(() => {
    if (!signInOpen && waiting && !signedIn) setWaiting(false);
  }, [signInOpen, waiting, signedIn]);

  const addFiles = async (picked: File[]) => {
    setError(null);
    try {
      const usable = picked.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
      const images = await Promise.all(usable.map(asImage));
      setFiles((list) => {
        const next = [...list, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))];
        next.slice(6).forEach((f) => URL.revokeObjectURL(f.url));
        return next.slice(0, 6);
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = (i: number) => {
    URL.revokeObjectURL(files[i]!.url);
    setFiles(files.filter((_, j) => j !== i));
  };
  // Previews are released when the welcome goes (the home has started).
  const previews = useRef(files);
  previews.current = files;
  useEffect(() => () => previews.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  const canSend = !busy && (text.trim() !== "" || files.length > 0);
  const submit = () => canSend && void run("auto");

  return (
    <div className="mx-auto max-w-[560px]" style={{ animation: "appear 500ms var(--ease) 80ms both" }}>
      <div
        className="rounded-[14px] border border-line-strong bg-card shadow-card focus-within:border-accent-line"
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {files.map((f, i) => (
              <div key={f.url} className="relative h-16 w-16 overflow-hidden rounded-[8px] border border-line bg-well">
                <img src={f.url} alt="" className="h-full w-full object-cover" />
                <Button variant="overlay" size="icon-xs" className="absolute right-0.5 top-0.5" onClick={() => remove(i)} title="Remove" aria-label="Remove">
                  <IconClose size={11} />
                </Button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={box}
          value={text}
          rows={3}
          autoFocus
          aria-label="Describe your home"
          placeholder="Describe your home, or drop in a floor plan…"
          className="block w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 font-sans text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center gap-2 px-3 pb-3">
          <Button variant="ghost" size="icon" onClick={() => fileInput.current?.click()} title="Add a floor plan or photos" aria-label="Add a floor plan or photos">
            <IconClip size={17} />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={`image/*,${PLAN_ACCEPT}`}
            multiple
            hidden
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <span className="grow text-xs text-muted">{aiEnabled && !signedIn ? "Sign in to start: new accounts get free credits." : ""}</span>
          <Button variant="primary" size="icon" onClick={submit} disabled={!canSend} title="Build it" aria-label="Build it">
            <IconArrowUp size={16} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <Button
            key={example}
            size="sm"
            onClick={() => {
              setText(example);
              box.current?.focus();
            }}
          >
            {example}
          </Button>
        ))}
        <Button
          size="sm"
          onClick={() => {
            if (!text.trim()) setText("Build my flat from this floor plan");
            fileInput.current?.click();
          }}
        >
          Build my flat from a floor plan…
        </Button>
      </div>

      {error && <div className="inline-error mt-3">{error}</div>}
      {busy && !waiting && <p className="mt-3 text-sm text-muted">Setting up your home…</p>}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run("own-key")}>
          {claudeCode ? "Use Claude Code or your own key" : "Use your own API key"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onStartWithoutAi}>
          Start without AI
        </Button>
      </div>
    </div>
  );
}
