// Telling open tabs which files of a home changed, so they reload them.
// In memory, so one server process; with several, this becomes Postgres
// LISTEN/NOTIFY (see docs/cloud-plan.md).
export interface HomeChange {
  path: string;
  // The new content's hash, or null when the file was deleted.
  hash: string | null;
}

type Listener = (change: HomeChange) => void;

export function createHomeEvents() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    subscribe(projectId: string, listener: Listener) {
      const set = listeners.get(projectId) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(projectId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(projectId);
      };
    },
    publish(projectId: string, change: HomeChange) {
      listeners.get(projectId)?.forEach((l) => l(change));
    },
  };
}

export type HomeEvents = ReturnType<typeof createHomeEvents>;
