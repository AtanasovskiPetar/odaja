// The in-app chat: talk to a model about the open design; it works with
// Odaja's tools and the scene updates live.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useOdaja } from "../../store";
import { ChatSettingsDialog } from "./ChatSettings";
import { useChat, type AssistantItem, type ImageInput, type Turn } from "./chatStore";

// Downscale big photos before sending: fewer tokens, same usefulness.
async function toImageInput(file: File): Promise<ImageInput> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.88);
  return { mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}

// Small Markdown subset: paragraphs, lists, headings, code, bold, inline code.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      blocks.push(<pre key={i}>{code.join("\n")}</pre>);
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ""));
      i--;
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={i}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </List>,
      );
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<h4 key={i}>{inline(line.replace(/^#+\s/, ""))}</h4>);
    } else if (line.trim()) {
      blocks.push(<p key={i}>{inline(line)}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}

const TOOL_LABELS: Record<string, string> = {
  get_overview: "Looked at the design",
  read_file: "Read a file",
  list_templates: "Checked templates",
  list_library: "Checked your library",
  add_object: "Added",
  update_object: "Changed",
  delete_object: "Removed",
  measure_object: "Measured",
  check_issues: "Checked issues",
  screenshot: "Took a screenshot",
  add_wall: "Added a wall",
  update_wall: "Changed a wall",
  delete_wall: "Removed a wall",
  add_opening: "Added an opening",
  update_opening: "Changed an opening",
  delete_opening: "Removed an opening",
  set_room: "Updated a room",
  create_scene: "Created a scene",
  save_to_library: "Saved to library",
};

function ToolChip({ item }: { item: Extract<AssistantItem, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const input = item.input as Record<string, unknown> | undefined;
  const detail = String(input?.name ?? input?.id ?? input?.view ?? "");
  const state = item.ok === undefined ? "running" : item.ok ? "ok" : "failed";
  return (
    <div className={`tool-chip ${state}`}>
      <button onClick={() => setOpen(!open)}>
        <span className="tool-state" />
        {TOOL_LABELS[item.name] ?? item.name}
        {detail && <span className="tool-detail"> {detail}</span>}
      </button>
      {open && (
        <div className="tool-body">
          <pre>{JSON.stringify(item.input, null, 1)}</pre>
          {item.summary && <pre>{item.summary}</pre>}
        </div>
      )}
    </div>
  );
}

function TurnView({ turn, live }: { turn: Turn; live: boolean }) {
  if (turn.role === "user") {
    return (
      <div className="turn user">
        {turn.images?.map((img, i) => (
          <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" />
        ))}
        {turn.text && <div className="bubble">{turn.text}</div>}
      </div>
    );
  }
  return (
    <div className="turn assistant">
      {turn.items.map((item, i) => (item.type === "text" ? <Markdown key={i} text={item.text} /> : <ToolChip key={i} item={item} />))}
      {live && turn.items.length === 0 && <div className="thinking">Thinking…</div>}
      {turn.error && <div className="chat-error">{turn.error}</div>}
    </div>
  );
}

function ModelPicker() {
  const providers = useChat((s) => s.providers);
  const provider = useChat((s) => s.provider);
  const models = useChat((s) => s.models);
  const model = useChat((s) => s.model);
  const modelsError = useChat((s) => s.modelsError);
  const selectProvider = useChat((s) => s.selectProvider);
  const selectModel = useChat((s) => s.selectModel);
  const info = providers.find((p) => p.id === provider);
  const current = models.find((m) => m.id === model);
  return (
    <div className="model-picker">
      <select value={provider ?? ""} onChange={(e) => selectProvider(e.target.value as never)}>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.ready ? "" : " (not set up)"}
          </option>
        ))}
      </select>
      <select value={model} onChange={(e) => selectModel(e.target.value)} disabled={models.length === 0}>
        {models.length === 0 && <option value="">{modelsError ? "No models" : "Loading…"}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.vision === false ? " · no images" : ""}
          </option>
        ))}
      </select>
      {info && !info.ready && <div className="picker-note">{info.status}</div>}
      {modelsError && <div className="picker-note">{modelsError}</div>}
      {current && current.tools === undefined && info?.kind === "local" && <div className="picker-note">Local models must support tool calling to change the design.</div>}
    </div>
  );
}

export function ChatPanel() {
  const status = useOdaja((s) => s.status);
  const turns = useChat((s) => s.turns);
  const busy = useChat((s) => s.busy);
  const chats = useChat((s) => s.chats);
  const chatId = useChat((s) => s.chatId);
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const openChat = useChat((s) => s.openChat);
  const deleteChat = useChat((s) => s.deleteChat);
  const toggle = useChat((s) => s.toggle);
  const settingsOpen = useChat((s) => s.settingsOpen);
  const setSettingsOpen = useChat((s) => s.setSettingsOpen);
  const refreshChats = useChat((s) => s.refreshChats);
  const projectDir = useOdaja((s) => s.projectDir);
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageInput[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Chats belong to the project: reload the list when it changes.
  useEffect(() => {
    openChat(null);
    refreshChats();
  }, [projectDir, openChat, refreshChats]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  const addFiles = async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith("image/"));
    const converted = await Promise.all(picked.map(toImageInput));
    setImages((imgs) => [...imgs, ...converted].slice(0, 6));
  };

  const submit = () => {
    if (busy || (!text.trim() && images.length === 0)) return;
    send(text.trim(), images);
    setText("");
    setImages([]);
  };

  if (status !== "project") return null;
  const title = chats.find((c) => c.id === chatId)?.title ?? "New chat";

  return (
    <aside className="chat-panel">
      <header className="chat-head">
        <button className="chat-title" onClick={() => setListOpen(!listOpen)} title="Conversations">
          {title} <span className="chevron">▾</span>
        </button>
        <button className="icon" onClick={() => openChat(null)} title="New chat">
          ＋
        </button>
        <button className="icon" onClick={() => setSettingsOpen(true)} title="Models and API keys">
          ⚙
        </button>
        <button className="icon" onClick={toggle} title="Close chat">
          ×
        </button>
      </header>
      {listOpen && (
        <ul className="chat-list">
          {chats.length === 0 && <li className="muted">No conversations yet.</li>}
          {chats.map((c) => (
            <li key={c.id} className={c.id === chatId ? "active" : ""}>
              <button
                onClick={() => {
                  openChat(c.id);
                  setListOpen(false);
                }}
              >
                {c.title}
                <span className="muted">{c.model || c.provider}</span>
              </button>
              <button className="remove" onClick={() => window.confirm(`Delete "${c.title}"?`) && deleteChat(c.id)} title="Delete">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <ModelPicker />
      <div className="chat-scroll" ref={scroller}>
        {turns.length === 0 && (
          <div className="chat-empty">
            <p>Ask about your design or tell me what to change. For example:</p>
            <ul>
              <li>"Is there enough space in front of the toilet?"</li>
              <li>"Move the sofa so it faces the TV, 2.5 m away."</li>
              <li>Paste a photo of a table and say "add this by the window, 180×90".</li>
            </ul>
          </div>
        )}
        {turns.map((t, i) => (
          <TurnView key={i} turn={t} live={busy && i === turns.length - 1} />
        ))}
      </div>
      <div
        className="composer"
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          addFiles([...e.dataTransfer.files]);
        }}
      >
        {images.length > 0 && (
          <div className="attachments">
            {images.map((img, i) => (
              <div key={i} className="attachment">
                <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                <button onClick={() => setImages(images.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={text}
          rows={3}
          placeholder="Message… (paste or drop photos)"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-row">
          <button className="icon" onClick={() => fileInput.current?.click()} title="Attach photos">
            📎
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <span className="grow" />
          {busy ? (
            <button className="send stop" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="send" onClick={submit} disabled={!text.trim() && images.length === 0}>
              Send
            </button>
          )}
        </div>
      </div>
      {settingsOpen && <ChatSettingsDialog />}
    </aside>
  );
}
