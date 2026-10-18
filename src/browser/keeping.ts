// Keeping the website's data: browsers may clear a site's storage when space
// runs low (or, in Safari, after 7 days without a visit), and private windows
// forget everything when closed. Ask to keep it, and warn where we can't.

let asked = false;

// Asks the browser to keep this site's storage. Chrome and Edge decide by
// themselves (installed or often used sites); Firefox asks the user. Called
// when a home is opened, so the request follows something the user did.
export function requestPersistence() {
  if (asked) return;
  asked = true;
  navigator.storage?.persist?.().catch(() => {});
}

const isSafari = () => /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// Browsers don't say whether a window is private, and Chrome and Safari
// deliberately look the same in both. Firefox private windows have no service
// workers. Elsewhere, the start screen says it in words.
const looksPrivate = () => /firefox/i.test(navigator.userAgent) && isSecureContext && !("serviceWorker" in navigator);

export type StorageNotice = "private" | "safari" | null;

export async function storageNotice(): Promise<StorageNotice> {
  if (looksPrivate()) return "private";
  if (isSafari() && !installed() && !(await navigator.storage?.persisted?.().catch(() => false))) return "safari";
  return null;
}
