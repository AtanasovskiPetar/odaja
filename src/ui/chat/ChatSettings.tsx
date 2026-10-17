// Connections for the chat: API keys, local model servers, default model.
// Keys are saved on this Mac only (~/.odaja/settings.json), never in projects.
import { useState } from "react";
import { saveDefaultModel, saveProviderSettings, useChat, type ProviderInfo } from "./chatStore";

const KEY_LINKS: Partial<Record<ProviderInfo["id"], string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
};

function ProviderRow({ provider, onSaved }: { provider: ProviderInfo; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(provider.baseUrl ?? "");
  const [command, setCommand] = useState(provider.commandPath ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (patch: { key?: string; baseUrl?: string; commandPath?: string }) => {
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
        <p className="hint">Uses the Claude Code installed on this Mac with your own sign-in. No API key, and usage counts toward your plan.</p>
      )}
      {provider.kind === "subscription" && (!provider.ready || provider.commandPath) && (
        <div className="provider-field">
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Path to claude, e.g. ~/.local/bin/claude" spellCheck={false} />
          <button disabled={busy || command === (provider.commandPath ?? "")} onClick={() => save({ commandPath: command })}>
            Save
          </button>
          {provider.commandPath && (
            <button disabled={busy} onClick={() => save({ commandPath: "" })} title="Find Claude Code by itself again">
              Reset
            </button>
          )}
        </div>
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
        <div className="provider-field">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Server URL" />
          <button disabled={busy || url === provider.baseUrl} onClick={() => save({ baseUrl: url })}>
            Save
          </button>
        </div>
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
        <p className="muted">Keys are stored only on this Mac, in ~/.odaja/settings.json, readable by your user alone.</p>
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
