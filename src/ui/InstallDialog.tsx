// "Install on your computer…" (the website's welcome and home menu): how to get the
// companion, the `odaja` program. The commands are the README's ("Install"),
// built from this page's address: the install scripts (public/install.sh,
// install.ps1) are part of the site, so on GitHub Pages they're the README's
// exactly, and they follow the site if it moves (in development: localhost).
import { useState } from "react";
import { useOdaja } from "../store";

const closeDialog = () => useOdaja.getState().openDialog(null);

// The script next to this page, without the page's query or hash.
const scriptUrl = (name: string) => new URL(name, location.href).href;

const WINDOWS = typeof navigator !== "undefined" && /Win/.test(navigator.platform);

// `onClose`: the welcome shows it itself (the app's dialogs aren't drawn there).
export function InstallDialog({ onClose: close = closeDialog }: { onClose?: () => void }) {
  const unix = { label: "macOS and Linux, in Terminal", command: `curl -fsSL ${scriptUrl("install.sh")} | sh` };
  const windows = { label: "Windows, in PowerShell", command: `irm ${scriptUrl("install.ps1")} | iex` };
  const commands = WINDOWS ? [windows, unix] : [unix, windows];

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog install-dialog" role="dialog" aria-label="Install Odaja on your computer">
        <h2>Install on your computer</h2>
        <p className="muted">The same Odaja, as a program on your computer. It adds what a web page can't do:</p>
        <ul className="install-points">
          <li>
            <strong>Homes as folders</strong> on your disk, which any editor or agent can change and the app shows live.
          </li>
          <li>
            <strong>Claude Code in the chat</strong>, on the subscription you already have, with no API key.
          </li>
          <li>
            <strong>Odaja's tools for your AI apps:</strong> Claude Code, Claude Desktop and other MCP clients can design with it.
          </li>
        </ul>
        {commands.map((c) => (
          <Command key={c.label} {...c} />
        ))}
        <p className="hint">
          Then run <code>odaja</code> to open it. A home kept here moves over as a file: save it (Save to file) and open it there.
        </p>
        <div className="dialog-buttons">
          <button type="button" className="primary" onClick={close} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Command({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      useOdaja.getState().setNotice("Couldn't copy. Select the command and copy it yourself.");
    }
  };
  return (
    <div className="install-command">
      <div className="install-command-label">{label}</div>
      <div className="install-command-row">
        <code>{command}</code>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
