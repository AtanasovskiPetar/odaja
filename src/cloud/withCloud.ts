// The cloud as an account, not another app (docs/cloud-plan.md): the local
// host (browser storage on the website, folders in the companion) is always
// there, and signing in adds the account's homes to the same list, their dirs
// marked `cloud:`. Opening a home picks where its files live; every other call
// goes to that host. Signing out goes back to the local home.
import type { Platform, ProjectList } from "../platform";
import { useCloudAuth } from "./auth";
import type { CloudPlatform } from "./platform";

const CLOUD = "cloud:";
const OPEN_IN = "odaja:open-in";

const remember = (where: "cloud" | "local") => {
  try {
    localStorage.setItem(OPEN_IN, where);
  } catch {
    // Storage unavailable: start with the local home next time.
  }
};
const remembered = () => {
  try {
    return localStorage.getItem(OPEN_IN);
  } catch {
    return null;
  }
};

export function withCloud(local: Platform, cloud: CloudPlatform): Platform {
  const signedIn = () => useCloudAuth.getState().status === "signed-in";
  let active: Platform = remembered() === "cloud" && signedIn() ? cloud : local;

  const use = (next: Platform) => {
    if (next === local && active === cloud) cloud.closeHome();
    active = next;
    remember(next === cloud ? "cloud" : "local");
  };

  // Signing out while a cloud home is open: back to the local home.
  useCloudAuth.subscribe((s, prev) => {
    if (s.status === prev.status) return;
    void import("../store").then(async ({ useOdaja }) => {
      if (s.status === "signed-out" && active === cloud) {
        use(local);
        await useOdaja.getState().load();
      }
      if (s.status === "signed-in" || s.status === "signed-out") await useOdaja.getState().refreshProjects().catch(() => {});
    });
  });

  const own: Partial<Platform> = {
    localKind: local.kind === "cloud" ? undefined : local.kind,
    async listProjects(): Promise<ProjectList> {
      const mine = await local.listProjects();
      const theirs = signedIn() ? await cloud.listProjects().catch(() => null) : null;
      if (active === cloud && !theirs?.current) use(local);
      // Back in a cloud home after a reload: follow its changes again.
      else if (active === cloud) await cloud.openProject(theirs!.current!);
      const cloudHomes = (theirs?.projects ?? []).map((p) => ({ ...p, dir: CLOUD + p.dir, cloud: true, inProjectsFolder: true }));
      return {
        ...mine,
        current: active === cloud ? CLOUD + theirs!.current : mine.current,
        projects: [...mine.projects, ...cloudHomes],
      };
    },
    async openProject(dir) {
      if (dir.startsWith(CLOUD)) {
        await cloud.openProject(dir.slice(CLOUD.length));
        use(cloud);
      } else {
        await local.openProject(dir);
        use(local);
      }
    },
    async openSample(fresh) {
      await local.openSample(fresh);
      use(local);
    },
    async createProject(name, room) {
      await local.createProject(name, room);
      use(local);
    },
    // Opening a .odaja file while an account home is open adds it to the
    // account (on the website, the local way would replace the browser's home).
    async importHome(data) {
      if (active === cloud) return cloud.importHome(data);
      await local.importHome(data);
      use(local);
    },
    // The furniture library is this computer's, whichever home is open;
    // placing an item copies it into the open home (cloud.placeLibraryModel).
    listLibrary: () => local.listLibrary(),
    newLibraryItem: (name) => local.newLibraryItem(name),
    writeLibraryFile: (path, data) => local.writeLibraryFile(path, data),
    libraryFileUrl: (path, version) => local.libraryFileUrl(path, version),
    deleteLibraryItem: (id) => local.deleteLibraryItem(id),
    libraryFiles: local.libraryFiles?.bind(local),
    async trashProject(dir) {
      if (dir.startsWith(CLOUD)) await cloud.trashProject!(dir.slice(CLOUD.length));
      else await local.trashProject?.(dir);
    },
    async renameProject(dir, name) {
      if (dir.startsWith(CLOUD)) await cloud.renameProject!(dir.slice(CLOUD.length), name);
      else await local.renameProject?.(dir, name);
    },
    // The open home's dir, as the home list knows it.
    async listScenes() {
      const r = await active.listScenes();
      return active === cloud ? { ...r, dir: CLOUD + r.dir } : r;
    },
    forgetProject: local.forgetProject?.bind(local),
    // Events from each host reach the app only while its home is open.
    onFileChanged(cb) {
      local.onFileChanged((p) => active === local && cb(p));
      cloud.onFileChanged((p) => active === cloud && cb(p));
    },
    onOpenSceneRequest(cb) {
      local.onOpenSceneRequest((p) => active === local && cb(p));
      cloud.onOpenSceneRequest((p) => active === cloud && cb(p));
    },
    onScreenshotRequest: local.onScreenshotRequest.bind(local),
    cloud: {
      signedIn,
      async createProject(name, room) {
        await cloud.createProject(name, room);
        use(cloud);
      },
      async copyOpenHome() {
        const file = await active.exportHome(true);
        await cloud.importHome(new Uint8Array(await file.arrayBuffer()));
        use(cloud);
      },
    },
  };

  return new Proxy(own as Platform, {
    get(target, key: keyof Platform) {
      if (key in target) return target[key];
      const value = active[key];
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
}
