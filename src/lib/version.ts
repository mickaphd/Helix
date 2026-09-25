/** Whether version `a` ("v1.10.0") comes after `b` ("1.9"): what the update check asks. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}
