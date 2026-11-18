// A test's conditions, checked by R after it ran: each data set's normality (Shapiro-Wilk)
// where the test assumes it, the equality of SDs where it does, the residuals of a model, the
// expected counts of a chi-square, a Cox model's proportional hazards. A check never stops a
// test: it says whether a condition holds and, when it doesn't, what to consider instead.
import { pText } from "../../lib/format";
import { dataGroups, pairedGroups, rVec, type Group } from "../column/base";
import { flattenGrouped } from "../grouped/base";
import { pickXY } from "../xy/linear-regression";
import { evalNamedVector } from "../webr";
import type { AnalysisParams, AnalysisResult, AnalysisType, Check, Column, LinearRegressionParams } from "../types";

type Params = Record<string, unknown> | undefined;

/** R: `sw(x)`, Shapiro-Wilk's P, none (NA) outside 3 to 5000 values or for values all alike. */
const R_SW =
  "sw<-function(x){x<-x[is.finite(x)];if(length(x)<3||length(x)>5000||var(x)==0)NA else shapiro.test(x)$p.value}";

/** What to test for normality, each named, and the test that doesn't assume it. */
interface Normality {
  /** R expressions of the values to test, by the name they're said with. */
  parts: { name: string; r: string }[];
  what: string;
  instead?: string;
}

/** The R for a list of normality tests: `w_i` each. */
const normalityR = (n: Normality) => n.parts.map((part, i) => `w_${i}=sw(${part.r})`).join(",");

/** The check said for normality tests' P values: all pass, or which may not. */
function normalityCheck(n: Normality, v: Record<string, number | null>): Check | undefined {
  const tested = n.parts.map((part, i) => ({ ...part, p: v[`w_${i}`] ?? null })).filter((t) => t.p != null);
  if (!tested.length)
    return { ok: true, text: `Normality ${n.what}: not tested (it needs 3 values or more that vary).` };
  const failing = tested.filter((t) => t.p! < 0.05);
  const each = (ts: typeof tested) => ts.map((t) => `${t.name} ${pText(t.p)}`).join(", ");
  if (!failing.length)
    return {
      ok: true,
      text: `Normality ${n.what} (Shapiro-Wilk): consistent with a normal distribution (${each(tested)}).`,
    };
  const names = failing.map((t) => t.name);
  const which = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return {
    ok: false,
    text:
      `Normality ${n.what} (Shapiro-Wilk): ${which} may not be normal (${failing.length > 1 ? each(failing) : pText(failing[0].p)}).` +
      (n.instead ? ` ${n.instead} doesn't assume it.` : " Transforming the data (logarithms) may help.") +
      " With few values the test rarely flags a departure; with many, even a slight one.",
  };
}

const named = (groups: Group[]) => groups.map((g) => ({ name: `“${g.name}”`, r: rVec(g.values) }));
const logs = (groups: Group[]) => groups.map((g) => ({ name: `“${g.name}”`, r: `log(${rVec(g.values)})` }));

export async function checksOf(
  type: AnalysisType,
  params: AnalysisParams | undefined,
  columns: Column[],
  result: AnalysisResult,
): Promise<Check[]> {
  const p = params as Params;
  const stat = (label: string) => result.stats.find((s) => s.label === label)?.value;
  const analyzedNames = new Set(result.groups.map((g) => g.name));
  const groups = () => dataGroups(columns).filter((c) => analyzedNames.has(c.name));
  const checks: Check[] = [];
  let normality: Normality | undefined;
  let extra = ""; // more R, its names its own
  let after: (v: Record<string, number | null>) => void = () => {};

  switch (type) {
    case "compare-two-groups": {
      if (p?.gaussian === false) return [];
      const two = groups().slice(0, 2);
      if (p?.paired) {
        const [a, b] = pairedGroups(two);
        if (!a || !b) return [];
        const ratio = p.ratio === true;
        normality = {
          parts: [
            {
              name: ratio ? `the log ratios “${a.name}” / “${b.name}”` : `the differences “${a.name}” − “${b.name}”`,
              r: ratio ? `log(${rVec(a.values)}/${rVec(b.values)})` : `${rVec(a.values)}-${rVec(b.values)}`,
            },
          ],
          what: ratio ? "of the log ratios" : "of the differences",
          instead: "The Wilcoxon matched-pairs test",
        };
        break;
      }
      normality = {
        parts: p?.lognormal ? logs(two) : named(two),
        what: p?.lognormal ? "of each group's logarithms" : "of each group",
        instead: "The Mann-Whitney test",
      };
      if (!p?.lognormal) {
        const fp = stat("F test P value");
        if (fp != null)
          checks.push(
            p?.equalVariance === false
              ? { ok: true, text: `Equal SDs (F test, ${pText(fp)}): not needed, Welch's t test doesn't assume them.` }
              : fp < 0.05
                ? {
                    ok: false,
                    text: `Equal SDs (F test, ${pText(fp)}): the SDs differ. Welch's t test doesn't assume they are equal.`,
                  }
                : { ok: true, text: `Equal SDs (F test, ${pText(fp)}): consistent with equal SDs.` },
          );
      }
      break;
    }
    case "one-sample-t":
      if (p?.gaussian === false) return [];
      normality = p?.lognormal
        ? { parts: logs(groups()), what: "of each column's logarithms", instead: "The Wilcoxon signed-rank test" }
        : { parts: named(groups()), what: "of each column", instead: "The Wilcoxon signed-rank test" };
      break;
    case "anova": {
      const gs = groups();
      const log = p?.lognormal === true;
      normality = log
        ? { parts: logs(gs), what: "of each group's logarithms", instead: "The Kruskal-Wallis test" }
        : { parts: named(gs), what: "of each group", instead: "The Kruskal-Wallis test" };
      // Brown-Forsythe (an ANOVA of each value's distance to its group's median) and Bartlett's,
      // of the logarithms for a lognormal ANOVA.
      extra =
        `,{G<-${log ? "lapply(" : ""}list(${gs.map((g) => rVec(g.values)).join(",")})${log ? ",log)" : ""};v<-unlist(G);gr<-factor(rep(seq_along(G),lengths(G)));` +
        "d<-abs(v-ave(v,gr,FUN=median));c(bf=tryCatch(oneway.test(d~gr,var.equal=TRUE)$p.value,error=function(e)NA)," +
        "bt=tryCatch(bartlett.test(v,gr)$p.value,error=function(e)NA))}";
      after = (v) => {
        if (v.bf == null && v.bt == null) return;
        const tests = `Brown-Forsythe ${pText(v.bf)}, Bartlett's ${pText(v.bt)}`;
        const differ = (v.bf ?? 1) < 0.05 || (v.bt ?? 1) < 0.05;
        checks.push(
          p?.equalSd === false
            ? { ok: true, text: `Equal SDs (${tests}): not needed, Welch's ANOVA doesn't assume them.` }
            : differ
              ? {
                  ok: false,
                  text: `Equal SDs (${tests}): the SDs may differ. Welch's ANOVA doesn't assume they are equal.`,
                }
              : { ok: true, text: `Equal SDs (${tests}): consistent with equal SDs.` },
        );
      };
      break;
    }
    case "rm-anova": {
      if (p?.mixed) return [];
      // The residuals once each subject's level and each group's are taken out.
      const gs = pairedGroups(columns);
      if (gs.length < 2) return [];
      normality = {
        parts: [
          {
            name: "the residuals",
            r: `{M<-cbind(${gs.map((g) => rVec(g.values)).join(",")});as.vector(M-outer(rowMeans(M),colMeans(M),"+")+mean(M))}`,
          },
        ],
        what: "of the residuals",
        instead: "The Friedman test",
      };
      const eps = stat("Geisser-Greenhouse epsilon");
      if (eps != null)
        checks.push({
          ok: true,
          text: `Sphericity: not assumed. The Geisser-Greenhouse epsilon (${Number(eps.toPrecision(3))}) corrects the degrees of freedom${eps < 0.75 ? ": the groups' differences vary in scatter from pair to pair" : ""}.`,
        });
      break;
    }
    case "two-way-anova": {
      if (p?.design !== "ordinary" && p?.design !== undefined) return [];
      const { values, group, row } = flattenGrouped(columns);
      const cell = group.map((g, i) => `${g}\u0000${row[i]}`);
      const codes = [...new Set(cell)];
      normality = {
        parts: [
          {
            name: "the residuals",
            r: `{v<-${rVec(values)};k<-${rVec(cell.map((c) => codes.indexOf(c)))};v-ave(v,k)}`,
          },
        ],
        what: "of the residuals",
        instead: "The Scheirer-Ray-Hare test",
      };
      break;
    }
    case "linear-regression": {
      if (result.fit) return [];
      const [x, y] = pickXY(columns, params as LinearRegressionParams | undefined);
      if (!x || !y) return [];
      const origin = (params as LinearRegressionParams | undefined)?.forceOrigin;
      normality = {
        parts: [{ name: "the residuals", r: `resid(lm(${rVec(y.values)}~${rVec(x.values)}${origin ? "+0" : ""}))` }],
        what: "of the residuals",
      };
      break;
    }
    case "correlation": {
      if (p?.method === "spearman" || result.matrix || (result.correlations?.length ?? 2) > 1) return [];
      // Pearson's P assumes both variables normal: those correlated.
      const names = result.correlations
        ? [columns.find((c) => c.values.length)?.name, result.correlations[0].variable]
        : result.groups.map((g) => g.name);
      const parts = names
        .map((n) => columns.find((c) => c.name === n || c.set === n))
        .filter((c): c is Column => c !== undefined);
      normality = { parts: named(parts), what: "of each variable", instead: "Spearman's correlation" };
      break;
    }
    case "chi-square": {
      // Fisher's exact test has no expected counts to meet.
      if (stat("P value (Fisher's exact test)") !== undefined) return [];
      const gs = pairedGroups(columns);
      extra = `,{m<-cbind(${gs.map((g) => rVec(g.values)).join(",")});e<-suppressWarnings(chisq.test(m))$expected;c(low=sum(e<5),cells=length(e))}`;
      after = (v) => {
        if (v.low == null) return;
        checks.push(
          v.low > 0
            ? {
                ok: false,
                text: `Expected counts: ${v.low} of ${v.cells} cells expect fewer than 5, so the chi-square P is approximate. Combining categories would help.`,
              }
            : { ok: true, text: "Expected counts: every cell expects 5 or more." },
        );
      };
      break;
    }
    case "cox": {
      const ph = stat("Proportional hazards test P");
      if (ph == null) return [];
      return [
        ph < 0.05
          ? {
              ok: false,
              text: `Proportional hazards (cox.zph, ${pText(ph)}): the hazard ratios may change over time, which the model assumes they don't.`,
            }
          : {
              ok: true,
              text: `Proportional hazards (cox.zph, ${pText(ph)}): consistent with ratios constant over time.`,
            },
      ];
    }
    default:
      return [];
  }

  const v = await evalNamedVector(`${R_SW};c(${normality ? normalityR(normality) : "none=NA"}${extra})`);
  const n = normality && normalityCheck(normality, v);
  after(v);
  return n ? [n, ...checks] : checks;
}
