// The prompt-first start (the welcome): describe the home or drop in a floor
// plan, and the AI builds it while you watch.
//   - With a key or model of your own already set up: a home here (browser or
//     folder), built with it.
//   - None yet: a home here, the chat open with the prompt, and the settings
//     to add a key ("Use your own API key"; in the companion with Claude
//     Code signed in, "Use Claude Code or your own key", which uses it).
// "Start without AI" shows the usual ways to start a home.
import { useEffect, useRef, useState } from "react";
import { useOdaja } from "../store";
import { useChat } from "./chat/chatStore";
import { IconArrowUp, IconClip, IconClose } from "./icons";
import { PLAN_DRAFT } from "./NewHome";
import { PLAN_ACCEPT } from "./planImage";
import { Button } from "./primitives/Button";

// Short enough to stay on one line on a phone.
const EXAMPLES = ["A two-bedroom flat, 65 m², open kitchen", "A 4 × 5 m living room facing the TV", "A 30 m² studio with a sleeping nook"];

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

// Start a home from the prompt, with the model already chosen, else the first
// one set up.
async function begin(text: string, files: File[]) {
  const chat = useChat.getState();
  await chat.loadProviders();
  const prompt = text.trim() || (files.length ? PLAN_DRAFT : "");
  const providers = useChat.getState().providers;
  const use = providers.find((p) => p.id === useChat.getState().provider && p.ready) ?? providers.find((p) => p.ready);
  await useOdaja.getState().createProject(homeNameFrom(prompt));
  if (!use) {
    // No AI yet: the home, the prompt in the chat, and where to add a key.
    chat.startDraft(prompt, files);
    chat.setSettingsOpen(true);
    return;
  }
  if (useChat.getState().provider !== use.id) await useChat.getState().selectProvider(use.id);
  // Sent as soon as the chat opens on the new home (an empty prompt waits there).
  useChat.getState().startDraft(prompt, files, Boolean(prompt));
}

export function PromptStart({ onStartWithoutAi }: { onStartWithoutAi: () => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // In the companion, "your own" can be your Claude Code subscription.
  const [claudeCode, setClaudeCode] = useState(false);

  useEffect(() => {
    void import("../agent/chat/models").then(({ claudeCode }) => claudeCode()).then((cc) => setClaudeCode(Boolean(cc?.ready)), () => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await begin(text, files.map((x) => x.file));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

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
  const submit = () => canSend && void run();

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
          <span className="grow" />
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
      {busy && <p className="mt-3 text-sm text-muted">Setting up your home…</p>}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>
          {claudeCode ? "Use Claude Code or your own key" : "Use your own API key"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onStartWithoutAi}>
          Start without AI
        </Button>
      </div>
    </div>
  );
}
