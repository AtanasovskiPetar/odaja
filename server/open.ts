// Opening Odaja in the default browser: the `odaja` program does when started
// (unless --no-open), `bun run companion` asks with --open.
import { spawn } from "node:child_process";
import { isCompiled } from "./env";

export const shouldOpen = () => process.argv.includes("--open") || (isCompiled && !process.argv.includes("--no-open"));

export function openInBrowser(url: string) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
