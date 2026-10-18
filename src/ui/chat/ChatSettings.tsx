// Connections for the chat: API keys, local model servers, default model.
// Keys are kept in this browser only (src/agent/chat/settings.ts), never in homes.
import { useState } from "react";
import { saveDefaultModel, saveProviderSettings } from "../../agent/chat/settings";
import { useChat, type ProviderInfo } from "./chatStore";

const KEY_LINKS: Partial<Record<ProviderInfo["id"], string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
};

// A web page may only talk to a local model server that allows it (CORS).
const LOCAL_HINTS: Partial<Record<ProviderInfo["id"], string>> = {
  ollama: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.origin)
    ? "Install Ollama and pull a model that can use tools."
    : `Ollama must allow this site: start it with OLLAMA_ORIGINS=${location.origin}.`,
  lmstudio: 'In LM Studio, start the server (Developer tab) and turn on "Enable CORS".',
};

function ProviderRow({ provider, onSaved }: { provider: ProviderInfo; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(provider.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (patch: { key?: string; baseUrl?: string }) => {
    setBusy(true);
    try {
      await saveProviderSettings(provider.id, patch);
      setKey("");
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="provider-row">
      <div className="provider-name">
        <strong>{provider.name}</strong>
        <span className={`dot ${provider.ready ? "ready" : ""}`} />
      </div>
      <div className="muted provider-status">{provider.status}</div>
      {provider.kind === "subscription" && (
        <p className="hint">
          Uses the Claude Code installed on this computer, signed in with your own Claude account; usage counts toward your plan. Only here, in the companion, and for
          your own use.
        </p>
      )}
      {provider.kind === "api-key" && (
        <div className="provider-field">
          <input
            type="password"
            value={key}
            placeholder={provider.keyHint ? `Saved key ${provider.keyHint}. Paste to replace` : "Paste API key"}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          <button disabled={busy || !key.trim()} onClick={() => save({ key })}>
            Save
          </button>
          {provider.keyHint && (
            <button disabled={busy} onClick={() => save({ key: "" })} title="Remove the saved key">
              Remove
            </button>
          )}
          {KEY_LINKS[provider.id] && (
            <a href={KEY_LINKS[provider.id]} target="_blank" rel="noreferrer">
              Get a key
            </a>
          )}
        </div>
      )}
      {provider.kind === "local" && (
        <>
          <div className="provider-field">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Server URL" />
            <button disabled={busy || url === provider.baseUrl} onClick={() => save({ baseUrl: url })}>
              Save
            </button>
          </div>
          <p className="hint">{LOCAL_HINTS[provider.id]}</p>
        </>
      )}
    </div>
  );
}

export function ChatSettingsDialog() {
  const providers = useChat((s) => s.providers);
  const provider = useChat((s) => s.provider);
  const model = useChat((s) => s.model);
  const loadProviders = useChat((s) => s.loadProviders);
  const close = () => useChat.getState().setSettingsOpen(false);
  const [savedDefault, setSavedDefault] = useState(false);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog chat-settings">
        <h2>Models and connections</h2>
        <p className="muted">Your keys stay in this browser, for this site only. The chat sends each key only to its own provider, straight from this page. Usage is billed to your account there.</p>
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} onSaved={loadProviders} />
        ))}
        <div className="dialog-buttons">
          {provider && model && (
            <button
              onClick={async () => {
                await saveDefaultModel(provider, model);
                setSavedDefault(true);
              }}
              title="Use the model selected in the chat by default"
            >
              {savedDefault ? "Saved as default ✓" : "Make current model the default"}
            </button>
          )}
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
