// The mean, SD, SEM, median and quartiles of numbers, for what the graphs draw at once
// (error bars, centers, boxes); analyses take theirs from R.

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** The smallest and largest of numbers, any number of them (Math.min(...v) overflows the
 *  call stack past ~100,000 values); ±Infinity with none. */
export const minOf = (v: number[]) => v.reduce((a, b) => (b < a ? b : a), Infinity);
export const maxOf = (v: number[]) => v.reduce((a, b) => (b > a ? b : a), -Infinity);

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

/** The `p` quantile as Descriptive statistics gives it (R's type 6, the (n + 1)p method):
 *  between the two values ranked around (n + 1)p, the smallest or largest beyond them. */
export function quantile(v: number[], p: number): number {
  const s = [...v].sort((a, b) => a - b);
  const h = Math.min(Math.max((s.length + 1) * p, 1), s.length) - 1;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}

/** A box as Helix draws it, handed to Plotly, which then computes none of its own: its
 *  quartiles (`quantile`) and whiskers to the minimum and maximum, or Tukey's: to the
 *  furthest values within 1.5 × IQR of the quartiles. */
export function boxOf(v: number[], whiskers: "minmax" | "tukey" = "minmax") {
  const [q1, q3] = [quantile(v, 0.25), quantile(v, 0.75)];
  const reach = whiskers === "tukey" ? 1.5 * (q3 - q1) : Infinity;
  const inside = v.filter((x) => x >= q1 - reach && x <= q3 + reach);
  return { q1, median: median(v), q3, lowerfence: minOf(inside), upperfence: maxOf(inside) };
}
