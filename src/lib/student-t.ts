// Student's t distribution, for the few P values and intervals computed in plain
// TypeScript (the volcano's per-row tests, a graph's regression band) rather than in R.

/** log Γ(x), Lanczos approximation. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  const t = x + 7.5;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction of the incomplete beta function (Numerical Recipes' `betacf`). */
function betacf(x: number, a: number, b: number): number {
  const FPMIN = 1e-300;
  const tiny = (v: number) => (Math.abs(v) < FPMIN ? FPMIN : v);
  let c = 1;
  let d = 1 / tiny(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 / tiny(1 + aa * d);
    c = tiny(1 + aa / c);
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 / tiny(1 + aa * d);
    c = tiny(1 + aa / c);
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(x, a, b)) / a : 1 - (front * betacf(1 - x, b, a)) / b;
}

/** Two-sided P value of a t statistic with `df` degrees of freedom. */
export const tTwoSidedP = (t: number, df: number) => ibeta(df / (df + t * t), df / 2, 0.5);

/** The two-sided 95% critical value of t (its 97.5th percentile), by bisection. */
export function tCrit95(df: number): number {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > 0.05) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
