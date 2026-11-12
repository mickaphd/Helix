// A histogram's bins, counted as R's hist() counts them (the tests check it does): its
// automatic bins are R's, Sturges' number of classes made "pretty" (R's own pretty(),
// ported below); a bin holds the values above its left edge up to its right one, the
// first one its left edge too.

/** The most bins a typed width may make: beyond, the graph draws its automatic bins. */
export const MAX_BINS = 500;

/** R's pretty(c(lo, hi), n, min.n): the `unit`, and the multiples of it `ns`…`nu` that
 *  cover lo and hi (R_pretty in R's src/appl/pretty.c, with pretty.default's defaults). */
function pretty(lo: number, hi: number, n: number, minN: number): number[] {
  const [h, h5, fMin] = [1.5, 0.5 + 1.5 * 1.5, 2 ** -20];
  const roundingEps = 1e-10;
  const dx = hi - lo;
  let cell: number;
  let small: boolean;
  if (dx === 0 && hi === 0) {
    cell = 1;
    small = true;
  } else {
    cell = Math.max(Math.abs(lo), Math.abs(hi));
    const u = (1 + (h5 >= 1.5 * h + 0.5 ? 1 / (1 + h) : 1.5 / (1 + h5))) * Math.max(1, n) * Number.EPSILON;
    small = dx < cell * u * 3;
  }
  if (small) {
    if (cell > 10) cell = 9 + cell / 10;
    cell *= 0.75;
    if (minN > 1) cell /= minN;
  } else {
    cell = dx;
    if (n > 1) cell /= n;
  }
  cell = Math.max(cell, fMin * 2.2250738585072014e-308);
  const base = 10 ** Math.floor(Math.log10(cell));
  let unit = base;
  if (2 * base - cell < h * (cell - unit)) {
    unit = 2 * base;
    if (5 * base - cell < h5 * (cell - unit)) {
      unit = 5 * base;
      if (10 * base - cell < h * (cell - unit)) unit = 10 * base;
    }
  }
  let ns = Math.floor(lo / unit + roundingEps);
  let nu = Math.ceil(hi / unit - roundingEps);
  while (ns * unit > lo + roundingEps * unit) ns--;
  while (nu * unit < hi - roundingEps * unit) nu++;
  let k = Math.floor(0.5 + nu - ns);
  if (k < minN) {
    k = minN - k;
    if (ns >= 0) {
      nu += Math.floor(k / 2);
      ns -= Math.floor(k / 2) + (k % 2);
    } else {
      ns -= Math.floor(k / 2);
      nu += Math.floor(k / 2) + (k % 2);
    }
    k = minN;
  }
  // seq(l, u, length.out = k + 1), its near-zero values made 0, as pretty.default does.
  const [l, u] = [Math.min(ns * unit, lo), Math.max(nu * unit, hi)];
  const by = (u - l) / k;
  return Array.from({ length: k + 1 }, (_, i) => (i === k ? u : l + i * by)).map((s) =>
    Math.abs(s) < 1e-14 * by ? 0 : s,
  );
}

const extentOf = (values: number[]) =>
  values.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity]);

/** The bins of a typed width: the first one's left edge (in widths) and how many. */
function typedBins(values: number[], width: number): { first: number; bins: number } {
  const [lo, hi] = extentOf(values);
  const first = Math.floor(lo / width + 1e-10);
  return { first, bins: Math.max(1, Math.ceil(hi / width - 1e-10) - first) };
}

/** Whether a typed width makes more than MAX_BINS bins of these values. */
export const tooManyBins = (values: number[], width?: number) =>
  values.length > 0 && width != null && width > 0 && typedBins(values, width).bins > MAX_BINS;

/** The bins' edges for these values: every `width` from a multiple of it, or (none,
 *  or more than MAX_BINS) the edges R's hist() picks for all the values together. */
export function binEdges(values: number[], width?: number): number[] {
  if (values.length === 0) return [];
  if (width != null && width > 0 && !tooManyBins(values, width)) {
    const { first, bins } = typedBins(values, width);
    return Array.from({ length: bins + 1 }, (_, i) => (first + i) * width);
  }
  const [lo, hi] = extentOf(values);
  return pretty(lo, hi, Math.ceil(Math.log2(values.length) + 1), 1);
}

/** How many values fall in each bin, as hist() counts (right-closed, the first bin
 *  closed on both sides, edges given hist's own 1e-7 fuzz). */
export function binCounts(values: number[], edges: number[]): number[] {
  const diffs = edges.slice(1).map((e, i) => e - edges[i]);
  const sorted = [...diffs].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const fuzz = 1e-7 * (sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2);
  const fuzzy = edges.map((e, i) => e + (i === 0 ? -fuzz : fuzz));
  const counts = diffs.map(() => 0);
  for (const v of values) {
    const i = fuzzy.findIndex((e, j) => j > 0 && v <= e);
    if (i > 0 && v > fuzzy[0]) counts[i - 1]++;
  }
  return counts;
}
