// Whether the open cloud home's changes have reached the server: shown next
// to the home's name (src/ui/HomeMenu.tsx). Kept by src/cloud/platform.ts.
import { create } from "zustand";

export type SaveState =
  // Everything is on the server.
  | "saved"
  // Changes are on their way.
  | "saving"
  // No connection: changes are kept in this tab and sent when it's back.
  | "offline"
  // The server refused or failed; trying again.
  | "failing";

export const useCloudSave = create<{ state: SaveState; detail: string | null }>(() => ({ state: "saved", detail: null }));

export const SAVE_LABELS: Record<SaveState, { label: string; title: string }> = {
  saved: { label: "Saved", title: "Every change is saved in your account." },
  saving: { label: "Saving…", title: "Saving your latest changes to your account." },
  offline: { label: "Offline", title: "You're offline. Your changes are kept in this tab and saved when you're back online. Don't close it until then." },
  failing: { label: "Not saved", title: "Your latest changes couldn't be saved yet. Odaja keeps trying." },
};
