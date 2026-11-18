// What a result means, in plain words: a sentence or two under its heading, every number
// R's (read from the result). A significant result says what differs and by how much; one
// that isn't never says the groups are the same, only that the data don't show they differ,
// with how large the difference could be when the test gives it (its 95% CI).
import type { Dataset } from "../../lib/dataset";
import { isSignificant, num, pText } from "../../lib/format";
import type { AnalysisParams, AnalysisResult, AnalysisType, Analyzed } from "../types";

type Params = Record<string, unknown> | undefined;

const q = (name: string) => `“${name}”`;
/** “A”, “B” and “C”. */
const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).map(q).join(", ")} and ${q(names.at(-1)!)}` : names.map(q).join("");
const percent = (share: number | null | undefined) => (share == null ? "—" : `${num(share * 100)}%`);
const ci = (lo: number | null | undefined, hi: number | null | undefined) => `95% CI ${num(lo)} to ${num(hi)}`;
const higher = (d: number | null | undefined) => ((d ?? 0) > 0 ? "higher" : "lower");
/** What r means, said once after the correlations. */
const SCALE = " (r runs from −1 to 1; 0 means no link.)";

export function conclusionOf(
  type: AnalysisType,
  params: AnalysisParams | undefined,
  result: AnalysisResult,
  analyzed: Analyzed | undefined,
  table: Dataset,
): string | undefined {
  const p = params as Params;
  const stat = (label: string) => result.stats.find((s) => s.label === label)?.value;
  const statStarting = (start: string) => result.stats.find((s) => s.label.startsWith(start));
  // A P value as written, one-tailed when the test was.
  const P = (value: number | null | undefined) =>
    p?.tails && p.tails !== "two-sided" ? `one-tailed ${pText(value)}` : pText(value);
  const sig = (value: number | null | undefined) => isSignificant(value);
  const [A, B] = result.groups.map((g) => g.name);
  const mean = (i: number) => num(result.groups[i]?.mean);
  const comparisons = (result.comparisons ?? []).filter((c) => c.group2);
  const differing = comparisons.filter((c) => sig(c.p));
  const pairsText = () => {
    if (!comparisons.length) return "";
    if (p?.posthoc === "dunnett" && typeof p.control === "string") {
      const others = differing.map((c) => (c.group1 === p.control ? c.group2 : c.group1));
      if (others.length > 4)
        return ` ${others.length} of ${comparisons.length} comparisons with ${q(p.control)} differ significantly.`;
      return others.length
        ? ` Compared with ${q(p.control)}, ${list(others)} ${others.length > 1 ? "differ" : "differs"} significantly.`
        : ` In the comparisons, no group differs significantly from ${q(p.control)}.`;
    }
    const named =
      differing.length <= 4 ? `: ${differing.map((c) => `${q(c.group1)} vs. ${q(c.group2)}`).join(", ")}` : "";
    return ` ${differing.length} of ${comparisons.length} pairs differ significantly in the comparisons${differing.length ? named : ""}.`;
  };

  switch (type) {
    case "compare-two-groups": {
      const pv = stat("P value");
      if (!A || !B) return undefined;
      if (p?.gaussian === false) {
        const hl = stat("Hodges-Lehmann difference");
        if (p.paired)
          return sig(pv)
            ? `Over the ${analyzed?.sets[0]?.n} pairs, ${q(A)} tends to be ${higher(hl)} than ${q(B)}, by about ${num(Math.abs(hl ?? NaN))} (Hodges-Lehmann estimate): a significant difference (${P(pv)}).`
            : `The data don't show a difference between ${q(A)} and ${q(B)} over the ${analyzed?.sets[0]?.n} pairs (${P(pv)}). That doesn't prove there is none.`;
        return sig(pv)
          ? `${q(A)}'s values tend to be ${higher(hl)} than ${q(B)}'s, by about ${num(Math.abs(hl ?? NaN))} (Hodges-Lehmann estimate): a significant difference (${P(pv)}).`
          : `The data don't show that ${q(A)}'s and ${q(B)}'s values differ (${P(pv)}). That doesn't prove they come from the same distribution.`;
      }
      const [lo, hi] = [stat("95% CI lower"), stat("95% CI upper")];
      if (p?.paired && p.ratio) {
        const r = stat("Geometric mean ratio");
        return sig(pv)
          ? `On average, ${q(A)} is ${num(r)} times ${q(B)} (the geometric mean of the ratios, ${ci(lo, hi)}): a significant change (${P(pv)}).`
          : `The data don't show that ${q(A)} differs from ${q(B)} in ratio (${P(pv)}). The ratio could be anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
      }
      if (p?.paired) {
        const d = stat("Mean of differences");
        const n = analyzed?.sets[0]?.n;
        return sig(pv)
          ? `Over the ${n} pairs, ${q(A)} is ${higher(d)} than ${q(B)}: ${q(A)} − ${q(B)} averages ${num(d)} (${ci(lo, hi)}), a significant difference (${P(pv)}).`
          : `The data don't show a difference between ${q(A)} and ${q(B)} over the ${n} pairs (${P(pv)}). That doesn't prove there is none: ${q(A)} − ${q(B)} could average anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
      }
      if (p?.lognormal) {
        const r = stat("Ratio of geometric means");
        const [gA, gB] = [stat(`Geometric mean (${A})`), stat(`Geometric mean (${B})`)];
        return sig(pv)
          ? `${q(A)}'s geometric mean (${num(gA)}) is ${num(r)} times ${q(B)}'s (${num(gB)}) (${ci(lo, hi)}): a significant difference (${P(pv)}).`
          : `The data don't show a difference between the geometric means of ${q(A)} (${num(gA)}) and ${q(B)} (${num(gB)}) (${P(pv)}). Their ratio could be anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
      }
      const d = stat("Mean difference");
      return sig(pv)
        ? `${q(A)}'s mean (${mean(0)}) is ${higher(d)} than ${q(B)}'s (${mean(1)}): ${q(A)} − ${q(B)} is ${num(d)} (${ci(lo, hi)}), a significant difference (${P(pv)}).`
        : `The data don't show a difference between the means of ${q(A)} (${mean(0)}) and ${q(B)} (${mean(1)}) (${P(pv)}). That doesn't prove they are equal: ${q(A)} − ${q(B)} could be anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
    }

    case "one-sample-t": {
      const value = p?.hypotheticalValue ?? 0;
      const what = p?.gaussian === false ? "median" : p?.lognormal ? "geometric mean" : "mean";
      return result.groups
        .map((g) => {
          const pv = stat(`${g.name} — P value`);
          const at = num(p?.gaussian === false ? g.median : p?.lognormal ? stat(`${g.name} — Geometric mean`) : g.mean);
          return sig(pv)
            ? `${q(g.name)}'s ${what} (${at}) differs significantly from ${value} (${P(pv)}).`
            : `The data don't show that ${q(g.name)}'s ${what} (${at}) differs from ${value} (${P(pv)}).`;
        })
        .join(" ");
    }

    case "anova":
    case "rm-anova":
    case "kruskal-wallis":
    case "friedman": {
      const pv = stat("P value");
      const ranks = type === "kruskal-wallis" || type === "friedman";
      const matched = type === "rm-anova" || type === "friedman";
      const r2 = stat("R squared (eta squared)");
      const share =
        type === "anova" && r2 != null
          ? ` The differences between the groups account for ${percent(r2)} of all the variation in the values (R²).`
          : "";
      const center = p?.lognormal ? "geometric mean" : "mean";
      return sig(pv)
        ? (ranks
            ? `At least one ${matched ? "matched " : ""}group tends to have higher or lower values than the others (${P(pv)}).`
            : `At least one ${matched ? "matched " : ""}group's ${center} differs from the others (${P(pv)}).`) +
            share +
            pairsText()
        : `The data don't show a difference among the ${result.groups.length} ${matched ? "matched " : ""}groups (${P(pv)}). That doesn't prove they are alike.` +
            (differing.length ? pairsText() : "");
    }

    case "two-way-anova": {
      const effect = (name: string) => stat(`${name} P value`);
      const [pg, pr, pi] = [effect("Group"), effect("Row"), effect("Interaction")];
      const said = (pv: number | null | undefined, yes: string, no: string) =>
        sig(pv) ? `${yes} (${P(pv)}).` : `${no} (${P(pv)}).`;
      const interaction =
        pi === undefined
          ? ""
          : sig(pi)
            ? `The difference between the groups depends on the row (a significant interaction, ${P(pi)}): look at the comparisons within each row or group, not only at the overall effects. `
            : `The data don't show that the difference between the groups depends on the row (interaction ${P(pi)}). `;
      return (
        interaction +
        said(pg, "Overall, the groups differ", "The data don't show an overall difference between the groups") +
        " " +
        said(pr, "Overall, the rows differ", "The data don't show an overall difference between the rows") +
        (comparisons.length ? pairsText() : "")
      );
    }

    case "multiple-t-tests": {
      const rows = stat("Rows compared");
      const k = stat("Significant rows (P < 0.05)");
      return k
        ? `${q(A ?? "")} and ${q(B ?? "")} differ significantly in ${k} of ${rows} rows (each row's P value corrected for testing every row).`
        : `The data don't show a difference between ${q(A ?? "")} and ${q(B ?? "")} in any of the ${rows} rows (each row's P value corrected for testing every row).`;
    }

    case "correlation":
    case "correlation-matrix": {
      if (result.matrix) {
        const { p: ps, variables } = result.matrix;
        let [k, m] = [0, 0];
        variables.forEach((_, i) =>
          variables.forEach((__, j) => {
            if (j <= i || ps[i][j] == null) return;
            m++;
            if (sig(ps[i][j])) k++;
          }),
        );
        return `${k} of ${m} pairs of variables ${k === 1 ? "is" : "are"} significantly correlated (each P on its own, not corrected for testing every pair).`;
      }
      const spearman = p?.method === "spearman";
      const one = (
        x: string,
        y: string,
        r: number | null | undefined,
        pv: number | null | undefined,
        lo?: number | null,
        hi?: number | null,
      ) => {
        const at = `${spearman ? "Spearman " : ""}r = ${num(r)}${lo != null && hi != null ? `, ${ci(lo, hi)}` : ""}, ${P(pv)}`;
        return sig(pv)
          ? `${q(x)} and ${q(y)} are ${(r ?? 0) > 0 ? "positively correlated: they tend to rise together" : "negatively correlated: one tends to fall as the other rises"} (${at}).`
          : `The data don't show a correlation between ${q(x)} and ${q(y)} (${at}).`;
      };
      if (result.correlations) {
        const x = table.sets[0]?.name ?? "X";
        return (
          result.correlations
            .filter((c) => c.r != null)
            .map((c) => one(x, c.variable, c.r, c.p, c.low, c.high))
            .join(" ") + SCALE
        );
      }
      return A && B
        ? one(
            A,
            B,
            stat(spearman ? "Spearman r" : "Pearson r"),
            stat("P value"),
            stat("95% CI lower"),
            stat("95% CI upper"),
          ) + SCALE
        : undefined;
    }

    case "linear-regression": {
      if (result.fit) {
        const rows = result.fit.rows;
        const slopes = rows.find((r) => r.label === "Slope")?.values ?? [];
        const ps = rows.find((r) => r.label.startsWith("P value"))?.values ?? [];
        const sets = result.fit.sets;
        const yes = sets.filter((_, i) => sig(ps[i]));
        const no = sets.filter((_, i) => !sig(ps[i]));
        return (
          (yes.length
            ? `The slope differs significantly from 0 for ${yes.map((n) => `${q(n)} (slope ${num(slopes[sets.indexOf(n)])}, ${P(ps[sets.indexOf(n)])})`).join(", ")}.`
            : "") +
          (no.length
            ? `${yes.length ? " " : ""}The data don't show that ${list(no)} change${no.length > 1 ? "" : "s"} with ${q(table.sets[0]?.name ?? "X")} (${no.map((n) => P(ps[sets.indexOf(n)])).join(", ")}).`
            : "")
        );
      }
      const [X, Y] = [A, B];
      if (!X || !Y) return undefined;
      const [slope, lo, hi, pv] = [
        stat("Slope"),
        stat("Slope 95% CI lower"),
        stat("Slope 95% CI upper"),
        stat("P value (slope ≠ 0)"),
      ];
      const r2 = p?.forceOrigin ? undefined : stat("R squared");
      return sig(pv)
        ? `${q(Y)} ${(slope ?? 0) > 0 ? "rises" : "falls"} by ${num(Math.abs(slope ?? NaN))} for each unit of ${q(X)} (the slope; ${ci(lo, hi)}): significantly different from a flat line (${P(pv)}).` +
            (r2 != null ? ` ${q(X)} accounts for ${percent(r2)} of ${q(Y)}'s variation (R²).` : "")
        : `The data don't show that ${q(Y)} changes with ${q(X)} (${P(pv)}). The slope could be anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
    }

    case "nonlinear-regression": {
      const fit = result.fit;
      if (!fit) return undefined;
      const pv = stat("P value");
      const midpoint = fit.rows.find((r) => /^(Log)?(EC50|IC50)$/.test(r.label))?.label.replace(/^Log/, "");
      if (pv !== undefined) {
        const [a, b] = fit.sets;
        if (p?.compare === "all")
          return sig(pv)
            ? `${q(a)} and ${q(b)} follow different curves: one curve can't describe both (extra sum-of-squares F test, ${P(pv)}).`
            : `The data don't show that ${q(a)} and ${q(b)} follow different curves (extra sum-of-squares F test, ${P(pv)}): one curve may describe both.`;
        return sig(pv)
          ? `${q(a)} and ${q(b)} reach half of their effect at different concentrations: their ${midpoint ?? "midpoint"}s differ (extra sum-of-squares F test, ${P(pv)}).`
          : `The data don't show that ${q(a)} and ${q(b)} reach half of their effect at different concentrations (their ${midpoint ?? "midpoint"}s; extra sum-of-squares F test, ${P(pv)}).`;
      }
      return fit.sets
        .map((set, i) => curveSentence(set, i, p?.model as string, result, table.sets[0]?.name ?? "X"))
        .join(" ");
    }

    case "logistic-regression": {
      const [or, lo, hi, pv, x50] = [
        stat("Odds ratio (per unit of X)"),
        stat("Odds ratio 95% CI lower"),
        stat("Odds ratio 95% CI upper"),
        stat("P value (likelihood ratio test)"),
        stat("X at 50% probability"),
      ];
      const [X, Y] = [A ?? "X", B ?? "Y"];
      return sig(pv)
        ? `Each time ${q(X)} rises by 1, the odds of ${q(Y)} being 1 are multiplied by ${num(or)} (${ci(lo, hi)}), so a 1 becomes ${(or ?? 1) > 1 ? "more" : "less"} likely: a significant effect (${P(pv)}). ${q(Y)} is as likely to be 1 as 0 when ${q(X)} is ${num(x50)}.`
        : `The data don't show that ${q(X)} changes how likely ${q(Y)} is to be 1 (${P(pv)}). Each unit of ${q(X)} could multiply its odds by anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
    }

    case "area-under-curve":
      return (result.areas ?? []).map((a) => `The area under ${q(a.variable)}'s curve is ${num(a.area)}.`).join(" ");

    case "multiple-regression": {
      const pv = stat("P value (model)");
      const Y = A ?? "Y";
      const terms = (result.coefficients ?? []).filter((c) => c.term !== "Intercept");
      const yes = terms.filter((c) => sig(c.p)).map((c) => c.term);
      const no = terms.filter((c) => !sig(c.p)).map((c) => c.term);
      return sig(pv)
        ? `Together, the predictors account for ${percent(stat("R squared"))} of ${q(Y)}'s variation (R²): a significant model (${P(pv)}).` +
            (yes.length
              ? ` Taking the other predictors into account, ${list(yes)} ${yes.length > 1 ? "have" : "has"} a significant effect of ${yes.length > 1 ? "their" : "its"} own`
              : " Taking the others into account, no predictor has a significant effect of its own") +
            (yes.length && no.length ? `; the data don't show one for ${list(no)}.` : ".")
        : `The data don't show that the predictors explain ${q(Y)} (${P(pv)}).`;
    }

    case "chi-square": {
      const fisher = result.stats.find((s) => s.p)?.value;
      if (statStarting("Relative risk (")) {
        const rows = table.titles
          .map((t, r) => ({ t, r }))
          .filter(({ r }) => table.columns.some((c) => c.byRow[r] != null))
          .map(({ t, r }) => t || `Row ${r + 1}`);
        const outcome = analyzed?.sets[0]?.name ?? "";
        const rr = statStarting("Relative risk (")?.value;
        const [lo, hi] = [stat("Relative risk 95% CI lower"), stat("Relative risk 95% CI upper")];
        return sig(fisher)
          ? `The share of ${q(outcome)} differs between ${q(rows[0])} and ${q(rows[1])} (${P(fisher)}): ${q(rows[0])}'s share is ${num(rr)} times ${q(rows[1])}'s (the relative risk; ${ci(lo, hi)}).`
          : `The data don't show that the share of ${q(outcome)} differs between ${q(rows[0])} and ${q(rows[1])} (${P(fisher)}). The relative risk could be anywhere from ${num(lo)} to ${num(hi)} (95% CI).`;
      }
      const pv = stat("P value");
      const trend = stat("Chi-square for trend") !== undefined;
      const first = analyzed?.sets[0]?.name ?? "";
      if (trend)
        return sig(pv)
          ? `The share of ${q(first)} rises or falls steadily down the rows, in their order (${P(pv)}).`
          : `The data don't show that the share of ${q(first)} rises or falls down the rows (${P(pv)}).`;
      return sig(pv)
        ? `How the counts split across the columns differs from row to row (${P(pv)}; Cramér's V = ${num(stat("Cramér's V"))}, from 0, no link, to 1).`
        : `The data don't show that the counts split across the columns differently from row to row (${P(pv)}).`;
    }

    case "survival": {
      const pv = stat("P value");
      const groups = result.survivalGroups ?? [];
      const medians = groups.length
        ? ` Median survival: ${groups.map((g) => `${q(g.group)} ${g.median == null ? "not reached" : num(g.median)}`).join(", ")}.`
        : "";
      const trend = result.subtitle?.includes("trend");
      if (trend)
        return (
          (sig(pv)
            ? `Survival changes with the groups' order, as in the table (test for trend, ${P(pv)}).`
            : `The data don't show a trend in survival across the groups, in their order (test for trend, ${P(pv)}).`) +
          medians
        );
      const hr = statStarting("Hazard ratio (log-rank)");
      const hrText =
        hr && groups.length === 2
          ? ` At any time, the event happens ${num(hr.value)} times as often in ${q(groups[0].group)} as in ${q(groups[1].group)} (log-rank hazard ratio, ${ci(result.stats[result.stats.indexOf(hr) + 1]?.value, result.stats[result.stats.indexOf(hr) + 2]?.value)}).`
          : "";
      return (
        (sig(pv)
          ? `The survival curves differ (${P(pv)}).${hrText}`
          : `The data don't show a difference between the survival curves (${P(pv)}). That doesn't prove they are alike.`) +
        medians +
        (comparisons.length ? pairsText() : "")
      );
    }

    case "cox": {
      const ratios = result.hazardRatios ?? [];
      return ratios
        .map((h) => {
          const [g, ref] = h.comparison.split(" vs. ");
          return sig(h.p)
            ? `At any time, the event happens ${num(h.ratio)} times as often in ${q(g)} as in ${q(ref)} (hazard ratio, ${ci(h.low, h.high)}, ${P(h.p)}).`
            : `The data don't show that ${q(g)}'s hazard differs from ${q(ref)}'s (${P(h.p)}).`;
        })
        .join(" ");
    }

    case "outliers": {
      const found = (result.outlierGroups ?? []).filter((g) => g.outliers > 0);
      return found.length
        ? `${found.reduce((a, g) => a + g.outliers, 0)} outlier${found.reduce((a, g) => a + g.outliers, 0) > 1 ? "s" : ""} found: ${found.map((g) => `${g.outliers} in ${q(g.group)}`).join(", ")}.`
        : "No outlier found.";
    }
  }
}

/** What a fitted curve says of one data set, in plain words: what its parameters mean (the
 *  level it tends to, where it is halfway, how fast it doubles or halves…), each with its
 *  95% CI, then how much of the variation the curve accounts for. Every number R's. */
function curveSentence(set: string, i: number, model: string, result: AnalysisResult, xName: string): string {
  const fit = result.fit!;
  const rows = fit.rows;
  const row = (label: string) => rows.findIndex((r) => r.label === label);
  // A best-fit value of this data set and its 95% CI (the row after it), or a parameter of
  // it (named "Set — Term" when several were fitted): the value, then its CI apart.
  const best = (label: string): [string, string] => {
    const at = row(label);
    const range = rows[at + 1]?.ranges?.[i];
    return [num(rows[at]?.values?.[i]), range ? ci(range[0], range[1]) : ""];
  };
  const param = (term: string): [string, string] => {
    const c = result.coefficients?.find((k) => k.term === term || k.term === `${set} — ${term}`);
    return [num(c?.estimate), c ? ci(c.low, c.high) : ""];
  };
  const [Y, X] = [q(set), q(xName)];
  const logX = model.endsWith("logx");
  let what: string;
  switch (model) {
    case "michaelis-menten":
    case "hyperbola": {
      const [top, low] = model === "hyperbola" ? ["Bmax", "Kd"] : ["Vmax", "Km"];
      const [max, maxCi] = param(top);
      const [half, halfCi] = param(low);
      what = `${Y} rises toward a maximum of ${max} (the ${top}; ${maxCi}), and reaches half of it when ${X} is ${half} (the ${low}; ${halfCi}).`;
      break;
    }
    case "exponential-growth": {
      const [time, range] = best("Doubling time");
      what = `${Y} doubles every ${time} units of ${X} (its doubling time; ${range}).`;
      break;
    }
    case "logistic-growth":
    case "gompertz-growth": {
      const [max, maxCi] = param("YM");
      what = `${Y} grows from ${param("Y0")[0]} toward a maximum of ${max} (YM; ${maxCi}), in an S shape${model === "gompertz-growth" ? " whose steepest point comes early, at about 37% of the maximum" : ""}.`;
      break;
    }
    case "two-phase-decay": {
      const [fast, fastCi] = best("Half-life (fast)");
      const [slow, slowCi] = best("Half-life (slow)");
      what = `${Y} falls toward a plateau of ${param("Plateau")[0]} in two phases: a fast one, ${param("PercentFast")[0]}% of the fall, with a half-life of ${fast} units of ${X} (${fastCi}), and a slow one with a half-life of ${slow} (${slowCi}).`;
      break;
    }
    case "one-phase-decay": {
      const [time, range] = best("Half-life");
      what = `${Y} falls toward a plateau of ${param("Plateau")[0]}, halving its distance to it every ${time} units of ${X} (its half-life; ${range}).`;
      break;
    }
    case "line": {
      const [slope, range] = param("Slope");
      what = `${Y} changes by ${slope} for each unit of ${X} (${range}).`;
      break;
    }
    case "semilog-line": {
      const [slope, range] = param("Slope");
      what = `${Y} changes in proportion to the logarithm of ${X}: by ${slope} for each unit of ln(${X}) (${range}).`;
      break;
    }
    case "quadratic":
    case "cubic":
      what = `A ${model === "quadratic" ? "second" : "third"}-order polynomial describes how ${Y} changes with ${X} (its coefficients below).`;
      break;
    default: {
      // Dose-response: between two plateaus, halfway at the EC50 or IC50.
      const mid = row("IC50") >= 0 ? "IC50" : "EC50";
      const [at, range] = row(mid) >= 0 ? best(mid) : param(mid);
      // An ECF reported too: where the curve has come F % of the way.
      const other = rows.find((r) => /^(EC|IC)\d+$/.test(r.label) && r.label !== mid)?.label;
      const [otherAt, otherRange] = other ? best(other) : ["", ""];
      what =
        `${Y} runs between two plateaus, ${param("Bottom")[0]} and ${param("Top")[0]}, and is halfway between them ` +
        `${logX ? "at a concentration of" : `when ${X} is`} ${at} (the ${mid}; ${range}).` +
        (other
          ? ` It has ${other.startsWith("IC") ? "fallen" : "come"} ${other.slice(2)}% of the way at ${otherAt} (the ${other}; ${otherRange}).`
          : "");
    }
  }
  const r2 = rows[row("R squared")]?.values?.[i];
  const left = (result.curveOutliers ?? []).filter((o) => o.set === set).length;
  return (
    `${what} The curve accounts for ${percent(r2)} of the variation in ${Y} (R²).` +
    (left ? ` ROUT left out ${left} outlier${left > 1 ? "s" : ""}.` : "")
  );
}
