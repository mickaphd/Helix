// The mean, SD, SEM and median of numbers, one way for the stats and the graphs alike.

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** The sample SD (n − 1); 0 with fewer than 2 values. */
export function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** The standard error of the mean; 0 with fewer than 2 values. */
export const sem = (v: number[]) => sd(v) / Math.sqrt(v.length);

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
