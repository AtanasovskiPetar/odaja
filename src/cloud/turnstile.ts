// Cloudflare Turnstile, when the cloud server has it on (its site key comes
// from /api/v1/config): a check that a person, not a bot, is making an
// account or asking for an email. The widget stays invisible unless
// Cloudflare wants an interaction (then it shows a box to tick). Each token
// works once, so one is asked for right before each request.
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't start")));
    script.onerror = () => reject(new Error("Couldn't load Turnstile"));
    document.head.append(script);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

export interface TurnstileWidget {
  token(): Promise<string>;
  remove(): void;
}

export async function mountTurnstile(container: HTMLElement, siteKey: string): Promise<TurnstileWidget> {
  const api = await loadTurnstile();
  // Its own box, so a widget being removed never touches a newer one.
  const el = document.createElement("div");
  container.append(el);
  let used = false;
  let waiting: { resolve(t: string): void; reject(e: Error): void } | null = null;
  const fail = (message: string) => {
    waiting?.reject(new Error(message));
    waiting = null;
  };
  const id = api.render(el, {
    sitekey: siteKey,
    execution: "execute",
    appearance: "interaction-only",
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : document.documentElement.dataset.theme === "light" ? "light" : "auto",
    size: "flexible",
    callback: (token: string) => {
      waiting?.resolve(token);
      waiting = null;
    },
    "error-callback": () => {
      fail("The check that you're a person didn't work. Try again.");
      return true;
    },
    "expired-callback": () => fail("The check that you're a person ran out of time. Try again."),
    "timeout-callback": () => fail("The check that you're a person ran out of time. Try again."),
  });
  return {
    token() {
      fail("Replaced by a newer check.");
      // A used token can't be used again: start a fresh check.
      if (used) api.reset(id);
      used = true;
      return new Promise<string>((resolve, reject) => {
        waiting = { resolve, reject };
        api.execute(id);
      });
    },
    remove() {
      fail("Closed.");
      api.remove(id);
      el.remove();
    },
  };
}
