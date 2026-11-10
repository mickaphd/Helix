// Kaplan-Meier survival of one group, as the Survival curve draws it: the step curve with its
// 95% confidence band (Greenwood's variance on the log-log scale, as Prism draws it) and the
// subjects censored. In plain TS, so a curve redraws at once; the Survival analysis gets the
// same from R's survival package (survfit), and the tests check that both agree.

const Z95 = 1.959963984540054;

interface KaplanMeier {
  /** The curve's steps, from (0, 1): a step at each time with an event, then on to the last
   *  subject followed. */
  t: number[];
  s: number[];
  /** The 95% band at each step (null where it can't be computed: S = 1 or S = 0). */
  lower: (number | null)[];
  upper: (number | null)[];
  /** The subjects censored without an event: their times, on the curve. */
  censorT: number[];
  censorS: number[];
}

/** The Kaplan-Meier curve of subjects followed for `times`, `codes` 1 (event) or 0 (censored). */
export function kaplanMeier(times: number[], codes: number[]): KaplanMeier {
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  const km: KaplanMeier = {
    t: [0],
    s: [1],
    lower: [null],
    upper: [null],
    censorT: [],
    censorS: [],
  };
  let atRisk = times.length;
  let survival = 1;
  let greenwood = 0;
  let i = 0;
  while (i < order.length) {
    const time = times[order[i]];
    let events = 0;
    let censored = 0;
    while (i < order.length && times[order[i]] === time) {
      if (codes[order[i]] === 1) events++;
      else censored++;
      i++;
    }
    if (events > 0) {
      survival *= 1 - events / atRisk;
      if (atRisk > events) greenwood += events / (atRisk * (atRisk - events));
      const [lower, upper] = logLogBand(survival, greenwood);
      km.t.push(time);
      km.s.push(survival);
      km.lower.push(lower);
      km.upper.push(upper);
    }
    if (censored > 0) {
      km.censorT.push(time);
      km.censorS.push(survival);
    }
    atRisk -= events + censored;
  }
  // The curve runs on to the last subject followed, as Prism draws it.
  const last = times[order.at(-1)!];
  if (last > km.t.at(-1)!) {
    km.t.push(last);
    km.s.push(survival);
    km.lower.push(km.lower.at(-1)!);
    km.upper.push(km.upper.at(-1)!);
  }
  return km;
}

/** S's 95% interval on the log-log scale, from Greenwood's sum. */
function logLogBand(s: number, greenwood: number): [number | null, number | null] {
  if (s <= 0 || s >= 1) return [null, null];
  const spread = (Z95 * Math.sqrt(greenwood)) / Math.log(s);
  const a = Math.exp(-Math.exp(Math.log(-Math.log(s)) + spread));
  const b = Math.exp(-Math.exp(Math.log(-Math.log(s)) - spread));
  return [Math.min(a, b), Math.max(a, b)];
}
