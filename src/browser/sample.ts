// The sample flat, bundled into the website: every file of
// examples/sample-flat (except the agent docs and dev chats) becomes a
// static asset, fetched when someone tries the sample.
const FILES = import.meta.glob(["../../examples/sample-flat/**/*", "!**/*.md", "!**/.odaja/**"], {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

const PREFIX = "examples/sample-flat/";

export async function sampleFiles(): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  await Promise.all(
    Object.entries(FILES).map(async ([key, load]) => {
      const rel = key.slice(key.indexOf(PREFIX) + PREFIX.length);
      const res = await fetch(await load());
      if (!res.ok) throw new Error(`couldn't load the sample (${rel})`);
      out[rel] = await res.blob();
    }),
  );
  return out;
}
