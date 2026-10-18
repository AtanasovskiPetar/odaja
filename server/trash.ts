// Moving a folder to the system Trash (so a deleted home can be restored):
// Finder's Trash on macOS, the Recycle Bin on Windows, the desktop trash on Linux.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// macOS: NSFileManager's trashItemAtURL, through JavaScript for Automation
// (it moves the item itself; it doesn't ask to control Finder).
const MAC_TRASH = `function run(argv) {
  ObjC.import("Foundation");
  const error = $();
  const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), null, error);
  return ok ? "ok" : ObjC.unwrap(error.localizedDescription);
}`;

export async function moveToTrash(dir: string): Promise<void> {
  if (process.platform === "darwin") {
    const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", MAC_TRASH, dir], { timeout: 30000 });
    if (stdout.trim() !== "ok") throw new Error(`couldn't move it to the Trash: ${stdout.trim()}`);
  } else if (process.platform === "win32") {
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($args[0], 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script, dir], { timeout: 30000 });
  } else {
    try {
      await run("gio", ["trash", dir], { timeout: 30000 });
    } catch {
      throw new Error("couldn't move it to the trash (the gio command isn't available); delete the folder yourself");
    }
  }
}
