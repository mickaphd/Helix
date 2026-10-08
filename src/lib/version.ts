// Versions: whether one comes after another, and the latest one out.

/** Whether version `a` ("v1.10.0") comes after `b` ("1.9"): what the update check asks. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

const RELEASE = "https://api.github.com/repos/mickaphd/Helix/releases/latest";
// GitHub answers 60 checks an hour per network (a lab's Macs share one). Past that, the
// version on the main branch, which runs ahead of a release only while it is being built.
const MAIN = "https://raw.githubusercontent.com/mickaphd/Helix/main/package.json";

/** The latest version out ("v1.0.4"); null when none is released yet. */
export async function latestVersion(): Promise<unknown> {
  const response = await fetch(RELEASE, { headers: { Accept: "application/vnd.github+json" } });
  if (response.status === 404) return null;
  if (response.ok) return (await response.json()).tag_name;
  const main = await fetch(MAIN);
  if (!main.ok) throw new Error(`GitHub answered ${main.status}`);
  return (await main.json()).version;
}
