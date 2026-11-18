// The questions each analysis asks before it runs, as Prism does: one question per
// step, each answer choosing the next question. A wizard only declares its questions
// and how the answers make the test's params; analysis-wizard.tsx asks them.
// A test without an entry here runs as soon as it is picked.
import { DOSE_MODELS, KINETIC_MODELS, NONLINEAR_MODELS, PAIR_CORRECTIONS, ROUT_Q } from "../../stats/types";
import { incompleteRows, pairIndices } from "../../stats/column/base";
import { pairKey } from "../../lib/columns";
import { rowName } from "../../stats/grouped/base";
import { MODEL_LABEL } from "../../stats/xy/nonlinear-regression";

const isDoseModel = (m: string) => (DOSE_MODELS as readonly string[]).includes(m);
import type {
  AnalysisParams,
  AnalysisPickerValue,
  AnalysisType,
  CompareTwoGroupsParams,
  CorrelationParams,
  MultipleTTestsParams,
  NonlinearRegressionParams,
  OneSampleTParams,
  SurvivalParams,
  CoxParams,
  ChiSquareParams,
  TwoWayAnovaParams,
  XYCorrelationParams,
} from "../../stats/types";
import { splitXY, type Dataset } from "../../lib/dataset";
import { hasXColumn, type TableType, type Transform } from "../../store/types";

export type Answer = string | number | string[];
export type Answers = Record<string, Answer | undefined>;

export type Question = { id: string; ask: string } & (
  | {
      kind: "choice";
      options: { value: string; label: string }[];
      /** Adds "Not sure — check for normality first", answered "yes" or "no" by Shapiro-Wilk. */
      normality?: boolean;
    }
  | { kind: "number"; label: string; initial: number; min?: number; max?: number; step?: number }
  /** Several of `options`, all ticked at first: at least `min` (1 by default). */
  | { kind: "names"; options: string[]; min?: number }
);

export interface Wizard {
  /** Every question, given the answers so far (false: not asked with these answers). */
  questions: (a: Answers, table: Dataset, type?: TableType) => (Question | false)[];
  /** The test to create, once every question is answered. */
  finish: (a: Answers, table: Dataset, type?: TableType) => { type: AnalysisType; params?: AnalysisParams };
}

const choice = (id: string, ask: string, options: [string, string][], normality = false): Question => ({
  id,
  ask,
  kind: "choice",
  options: options.map(([value, label]) => ({ value, label })),
  normality,
});

const names = (list: string[]) => list.map((n): [string, string] => [n, n]);

/** The Y data sets to fit, all ticked at first (asked when there is a choice); one answered
 *  is the regression's `y`, several its `ys`. */
const ysQuestion = (table: Dataset, ask: string): Question | false =>
  yNames(table).length > 1 && { id: "ys", ask, kind: "names", options: yNames(table), min: 1 };
const fittedYs = (a: Answers) => {
  const ys = a.ys as string[] | undefined;
  return ys === undefined ? {} : ys.length === 1 ? { y: ys[0] } : { ys };
};
const yNames = (table: Dataset) => splitXY(table.columns).ys.map((c) => c.name);
const dataNames = (table: Dataset) => table.numeric.map((c) => c.name);

// Which data sets a test runs on (`sets`), asked first as in Prism, and only when there
// is a choice: columns, or a grouped table's groups, holding numbers.
const setNames = (table: Dataset) =>
  table.sets.filter((s) => s.columns.some((c) => c.values.length > 0)).map((s) => s.name);

/** The two data sets to compare, in order. */
const twoSets = (a: Answers, table: Dataset): Question[] => {
  const sets = setNames(table);
  if (sets.length <= 2) return [];
  return [
    choice("set1", "Which is the first data set?", names(sets)),
    choice("set2", "Which is the second data set?", names(sets.filter((n) => n !== a.set1))),
  ];
};

/** The data sets to analyze, at least `min`, all ticked at first. */
const someSets = (table: Dataset, min: number): Question[] => {
  const sets = setNames(table);
  if (sets.length <= min) return [];
  const ask = min > 1 ? `Choose the data sets to analyze (at least ${min}).` : "Choose the data sets to analyze.";
  return [{ id: "sets", ask, kind: "names", options: sets, min }];
};

/** The answers of the data set questions `wizard` asks first, given the data sets to analyze
 *  (a graph's): them all to tick, or the first two as the two compared. */
export function answersFor(wizard: Wizard, table: Dataset, tableType: TableType | undefined, sets?: string[]): Answers {
  if (!sets) return {};
  const asked = new Set(wizard.questions({}, table, tableType).flatMap((q) => (q ? [q.id] : [])));
  if (asked.has("sets")) return { sets };
  if (asked.has("set1") && sets.length >= 2) return { set1: sets[0], set2: sets[1] };
  return {};
}

/** Every pair of `sets`, as a wizard lists it ("A vs. B") and as params keep it (`pairKey`). */
const pairLabels = (sets: string[]) =>
  pairIndices(sets.length).map(([i, j]) => ({ label: `${sets[i]} vs. ${sets[j]}`, key: pairKey(sets[i], sets[j]) }));

/** Whether a post-hoc compares chosen pairs (Bonferroni, Šidák, Holm-Šidák, Fisher's LSD). */
const isPairCorrection = (posthoc: unknown) => (PAIR_CORRECTIONS as readonly unknown[]).includes(posthoc);

/** The names ticked once `name` is ticked (`on`) or not: always in `options`' order,
 *  the table's, whatever order they were clicked in. */
export const toggled = (options: string[], ticked: string[], name: string, on: boolean) =>
  options.filter((n) => (n === name ? on : ticked.includes(n)));

/** Whether some subjects (rows) hold values in some of the data sets but not all. */
const gaps = (table: Dataset, sets?: string[]) =>
  incompleteRows(table.numeric.filter((c) => !sets || sets.includes(c.set ?? c.name))) > 0;

/** A grouped table's rows holding data, by the names results give them. */
const dataRows = (table: Dataset) =>
  table.titles.flatMap((_, r) => (table.numeric.some((c) => c.byRow[r] != null) ? [rowName(table.titles, r)] : []));

/** Whether a grouped table holds replicates: a group with 2 values or more at a row. */
const replicated = (table: Dataset) =>
  table.sets.some((s) => s.columns[0]?.byRow.some((_, r) => s.columns.filter((c) => c.byRow[r] != null).length > 1));

/** The data sets answered, if they were asked. */
export const chosenSets = (a: Answers): string[] | undefined =>
  a.set1 && a.set2 ? [a.set1 as string, a.set2 as string] : (a.sets as string[] | undefined);

/** `params` with the data sets answered. */
const withSets = <P extends object>(a: Answers, params?: P) => {
  const sets = chosenSets(a);
  return sets ? { ...params, sets } : params;
};

const GAUSSIAN = "Assume the data are sampled from Gaussian (normal) distributions?";
const PAIRED = "How were the data collected?";

/** How a table computed from this one transforms its values (lib/transform.ts): a percent
 *  asks of which data set, a z-score within what. An XY table's X is never one. */
export const TRANSFORM_WIZARD = {
  questions: (a: Answers, table: Dataset, type?: TableType): (Question | false)[] => [
    choice("kind", "How should the values be transformed?", [
      ["log10", "Logarithm, base 10"],
      ["log2", "Logarithm, base 2"],
      ["ln", "Natural logarithm (ln)"],
      ["normalize", "Normalize each data set: its smallest value 0 %, its largest 100 %"],
      ["percent-of-control", "Percent of a control data set's mean"],
      ["z-score", "Z-scores: how many SDs each value lies from the mean"],
    ]),
    a.kind === "percent-of-control" &&
      choice(
        "control",
        type === "grouped" || type === "xy"
          ? "Which data set is the control? Each value is a percent of its mean in the same row."
          : "Which data set is the control?",
        names(setNames(table).filter((n) => !(type && hasXColumn(type) && n === table.sets[0]?.name))),
      ),
    a.kind === "z-score" &&
      choice("within", "Z-scores within what?", [
        ["set", "Each data set: its own mean and SD"],
        ["row", "Each row: its own mean and SD (genes on a heatmap, say)"],
      ]),
  ],
  finish: (a: Answers): Omit<Transform, "from"> => {
    const kind = a.kind as Transform["kind"];
    if (kind === "percent-of-control") return { kind, control: a.control as string };
    if (kind === "z-score") return { kind, within: a.within === "row" ? "row" : "set" };
    return { kind };
  },
};

/** A contingency table's shape: its columns holding counts, and its rows with a count in each. */
const contingencyShape = (table: Dataset) => ({
  cols: table.numeric.length,
  rows: table.titles.filter((_, r) => table.numeric.every((c) => c.byRow[r] != null)).length,
});

export const WIZARDS: Partial<Record<AnalysisPickerValue, Wizard>> = {
  "chi-square": {
    // A test to choose on a 2 × 2 (Fisher's or the chi-square) and on 2 columns of 3 rows or
    // more (the chi-square or its test for trend); none for a larger table.
    questions: (_, table) => {
      const { rows, cols } = contingencyShape(table);
      if (rows === 2 && cols === 2)
        return [
          choice("test", "Which test?", [
            ["fisher", "Fisher's exact test (recommended: exact, at any size)"],
            ["yates", "Chi-square test with Yates' correction"],
            ["chi-square", "Chi-square test without correction"],
          ]),
        ];
      if (cols === 2 && rows >= 3)
        return [
          choice("test", "Which test?", [
            ["chi-square", "Chi-square test: do the shares differ from row to row?"],
            ["trend", "Chi-square test for trend: do they rise or fall down the rows, in their order?"],
          ]),
        ];
      return [];
    },
    finish: (a) => ({ type: "chi-square", params: a.test ? { test: a.test as ChiSquareParams["test"] } : {} }),
  },
  "descriptive-statistics": {
    questions: (_, table) => someSets(table, 1),
    finish: (a) => ({ type: "descriptive-statistics", params: withSets(a) }),
  },

  "shapiro-wilk": {
    questions: (_, table) => someSets(table, 1),
    finish: (a) => ({ type: "shapiro-wilk", params: withSets(a) }),
  },

  "compare-two-groups": {
    questions: (a, table) => {
      const [first = "Group 1", second = "Group 2"] = chosenSets(a) ?? setNames(table);
      const gaussian = a.gaussian === "yes";
      return [
        ...twoSets(a, table),
        choice("paired", PAIRED, [
          ["unpaired", "Unpaired (independent groups)"],
          ["paired", "Paired (matched samples)"],
        ]),
        choice(
          "gaussian",
          GAUSSIAN,
          [
            ["yes", "Yes — use a parametric test"],
            ["no", "No — use a non-parametric test"],
          ],
          true,
        ),
        gaussian &&
          (a.paired === "paired"
            ? choice("ratio", "How should the paired values be compared?", [
                ["diff", "Compute differences (paired t test)"],
                ["ratio", "Compute ratios (ratio t test) — for log-normal data"],
              ])
            : choice("lognormal", "How should the two groups be compared?", [
                ["no", "Compare means (t test)"],
                ["yes", "Compare geometric means (lognormal t test) — for log-normal data"],
              ])),
        gaussian &&
          a.paired !== "paired" &&
          choice("variance", "Assume the two groups have equal variances?", [
            ["equal", a.lognormal === "yes" ? "Yes — lognormal t test" : "Yes — Student's t test"],
            ["unequal", a.lognormal === "yes" ? "No — lognormal Welch's t test" : "No — Welch's t test"],
          ]),
        choice("tails", "One-tailed or two-tailed P value?", [
          ["two-sided", "Two-tailed (recommended)"],
          ["less", `One-tailed: expect ${first} < ${second}`],
          ["greater", `One-tailed: expect ${first} > ${second}`],
        ]),
      ];
    },
    // An answer left from a question no longer asked (after Back) doesn't count.
    finish: (a) => {
      const [paired, gaussian] = [a.paired === "paired", a.gaussian === "yes"];
      return {
        type: "compare-two-groups",
        params: withSets(a, {
          paired,
          gaussian,
          equalVariance: a.variance !== "unequal",
          ratio: paired && gaussian && a.ratio === "ratio",
          ...(!paired && gaussian && a.lognormal === "yes" ? { lognormal: true } : {}),
          tails: a.tails as CompareTwoGroupsParams["tails"],
        }),
      };
    },
  },

  "compare-many-groups": {
    questions: (a, table) => {
      const paired = a.paired === "paired";
      const nonParametric = paired ? "Friedman test" : "Kruskal-Wallis test";
      // Independent groups sampled from Gaussian distributions: equal SDs or not.
      const anova = !paired && a.gaussian === "yes";
      const posthocs: [string, string][] =
        a.gaussian !== "yes"
          ? [
              ["none", `No — only the overall ${nonParametric}`],
              ["dunn", "Yes — Dunn's multiple comparisons test (Bonferroni-corrected)"],
            ]
          : anova && a.equalSd === "no"
            ? [
                ["none", "No — only the overall Welch's ANOVA"],
                ["games-howell", "Yes, every pair — Games-Howell test"],
                ["t3", "Yes, every pair — Dunnett's T3 test (fewer than 50 values per group)"],
              ]
            : [
                ["none", "No — only the overall ANOVA"],
                ["tukey", "Yes, every pair — Tukey's multiple comparisons test"],
                ...(anova
                  ? [["dunnett", "Yes, each group against a control — Dunnett's test"] as [string, string]]
                  : []),
                ["bonferroni", "Yes, pairs I choose — Bonferroni correction"],
                ["sidak", "Yes, pairs I choose — Šidák correction"],
                ["holm-sidak", "Yes, pairs I choose — Holm-Šidák correction (more powerful)"],
                ["fisher", "Yes, pairs I choose — Fisher's LSD (no correction)"],
              ];
      const pairs = pairLabels(chosenSets(a) ?? setNames(table));
      return [
        ...someSets(table, 3),
        choice("paired", PAIRED, [
          ["unpaired", "Unpaired (independent groups)"],
          ["paired", "Paired (matched / repeated-measures)"],
        ]),
        choice(
          "gaussian",
          GAUSSIAN,
          [
            ["yes", `Yes — ${paired ? "repeated-measures" : "one-way"} ANOVA (parametric)`],
            ["no", `No — ${nonParametric} (non-parametric)`],
          ],
          true,
        ),
        anova &&
          choice("lognormal", "How should the groups be compared?", [
            ["no", "Compare means (one-way ANOVA)"],
            ["yes", "Compare geometric means (lognormal ANOVA) — for log-normal data"],
          ]),
        anova &&
          choice(
            "equalSd",
            a.lognormal === "yes"
              ? "Assume the groups' logarithms have equal SDs?"
              : "Assume the groups have equal SDs?",
            [
              ["yes", a.lognormal === "yes" ? "Yes — lognormal one-way ANOVA" : "Yes — ordinary one-way ANOVA"],
              ["no", a.lognormal === "yes" ? "No — lognormal Welch's ANOVA" : "No — Welch's ANOVA"],
            ],
          ),
        paired &&
          a.gaussian === "yes" &&
          gaps(table, chosenSets(a)) &&
          choice("mixed", "Some subjects lack a value in some groups. How should they be handled?", [
            ["yes", "Fit a mixed-effects model, keeping every value (recommended)"],
            ["no", "Leave out those subjects: repeated-measures ANOVA of the complete ones"],
          ]),
        paired &&
          a.gaussian === "yes" &&
          !(gaps(table, chosenSets(a)) && a.mixed !== "no") &&
          choice("sphericity", "Assume sphericity (equal variability of the differences between groups)?", [
            ["no", "No — Geisser-Greenhouse correction (recommended)"],
            ["yes", "Yes — no correction"],
          ]),
        choice("posthoc", paired ? "Compare the matched groups?" : "Compare the groups?", posthocs),
        a.posthoc === "dunnett" &&
          choice("control", "Which group is the control?", names(chosenSets(a) ?? setNames(table))),
        isPairCorrection(a.posthoc) &&
          pairs.length > 1 && {
            id: "compared",
            ask: "Which pairs should be compared? The fewer, the less each P value is corrected.",
            kind: "names",
            options: pairs.map((p) => p.label),
            min: 1,
          },
      ];
    },
    finish: (a, table) => {
      const paired = a.paired === "paired";
      const type = a.gaussian === "yes" ? (paired ? "rm-anova" : "anova") : paired ? "friedman" : "kruskal-wallis";
      const anova = type === "anova" && {
        equalSd: a.equalSd !== "no",
        ...(a.lognormal === "yes" ? { lognormal: true } : {}),
        ...(a.posthoc === "dunnett" ? { control: a.control as string } : {}),
      };
      // A mixed-effects model assumes sphericity: it is asked of complete subjects alone.
      const mixed = type === "rm-anova" && gaps(table, chosenSets(a)) && a.mixed !== "no";
      const rm = type === "rm-anova" && (mixed ? { mixed: true } : { sphericity: a.sphericity === "yes" });
      // The pairs ticked, by their keys, when not every pair.
      const pairs = pairLabels(chosenSets(a) ?? setNames(table));
      const ticked = Array.isArray(a.compared)
        ? pairs.filter((p) => (a.compared as string[]).includes(p.label))
        : pairs;
      const compared = isPairCorrection(a.posthoc) &&
        ticked.length < pairs.length && { compared: ticked.map((p) => p.key) };
      return {
        type,
        params: withSets(a, { posthoc: a.posthoc, ...anova, ...rm, ...compared }) as AnalysisParams,
      };
    },
  },

  "one-sample-t": {
    questions: (a, table) => {
      const center = a.gaussian !== "yes" ? "median" : a.lognormal === "yes" ? "geometric mean" : "mean";
      return [
        ...someSets(table, 1),
        {
          id: "value",
          ask: "Which hypothetical value should each data set be tested against?",
          kind: "number",
          label: "Hypothetical value",
          initial: 0,
        },
        choice(
          "gaussian",
          "Assume the data are sampled from a Gaussian (normal) distribution?",
          [
            ["yes", "Yes — one-sample t test (parametric)"],
            ["no", "No — Wilcoxon signed-rank test (non-parametric)"],
          ],
          true,
        ),
        a.gaussian === "yes" &&
          choice("lognormal", "What should be compared to the hypothetical value?", [
            ["no", "The mean (one-sample t test)"],
            ["yes", "The geometric mean (lognormal t test) — for log-normal data, a value above 0"],
          ]),
        choice("tails", "One-tailed or two-tailed P value?", [
          ["two-sided", "Two-tailed (recommended)"],
          ["less", `One-tailed: expect ${center} < hypothetical value`],
          ["greater", `One-tailed: expect ${center} > hypothetical value`],
        ]),
      ];
    },
    finish: (a) => ({
      type: "one-sample-t",
      params: withSets(a, {
        hypotheticalValue: a.value as number,
        gaussian: a.gaussian === "yes",
        ...(a.gaussian === "yes" && a.lognormal === "yes" ? { lognormal: true } : {}),
        tails: a.tails as OneSampleTParams["tails"],
      }),
    }),
  },

  outliers: {
    questions: (a, table) => [
      ...someSets(table, 1),
      choice("method", "Which method should look for outliers?", [
        ["rout", "ROUT — finds any number of outliers (recommended)"],
        ["grubbs", "Grubbs — finds one outlier at most in each data set"],
      ]),
      a.method !== "grubbs" && {
        id: "q",
        ask: "How strict should the search be? ROUT fits each data set to a robust mean and flags a point as an outlier when its false discovery rate is below Q: a smaller Q flags fewer.",
        kind: "number",
        label: "Q (%) =",
        initial: 1,
        ...ROUT_Q,
        step: 0.5,
      },
    ],
    finish: (a) => ({
      type: "outliers",
      params: withSets(a, a.method === "grubbs" ? { q: 1, grubbs: true } : { q: a.q as number }),
    }),
  },

  correlation: {
    questions: (a, table) => {
      const ys = yNames(table);
      return [
        choice("method", "Which correlation coefficient should be computed?", [
          ["pearson", "Pearson (parametric)"],
          ["spearman", "Spearman (non-parametric)"],
        ]),
        choice("mode", "What do you want to correlate?", [
          ["x-vs-every-y", "X against every Y data set"],
          ["two-datasets", "Two chosen data sets"],
          ["matrix", "Correlation matrix among the Y data sets"],
        ]),
        a.mode === "two-datasets" && choice("first", "Which is the first data set?", names(ys)),
        a.mode === "two-datasets" &&
          choice("second", "Which is the second data set?", names(ys.filter((n) => n !== a.first))),
      ];
    },
    finish: (a) => ({
      type: "correlation",
      params: {
        method: a.method as XYCorrelationParams["method"],
        mode: a.mode as XYCorrelationParams["mode"],
        ...(a.mode === "two-datasets" ? { datasets: [a.first as string, a.second as string] as [string, string] } : {}),
      },
    }),
  },

  "linear-regression": {
    // A Multiple Variables table has no X column: both variables are asked.
    questions: (a, table, type) => [
      type === "multiple" && choice("x", "Which variable is X?", names(dataNames(table))),
      type === "multiple"
        ? choice("y", "Which variable is Y?", names(dataNames(table).filter((n) => n !== a.x)))
        : ysQuestion(table, "Which Y data sets should be regressed on X? Each is regressed on its own."),
      choice("origin", "Force the line through the origin (0,0)?", [
        ["no", "No — fit both slope and Y-intercept (recommended)"],
        ["yes", "Yes — assume Y = 0 when X = 0"],
      ]),
    ],
    finish: (a) => ({
      type: "linear-regression",
      params: {
        ...(a.x === undefined ? { ...fittedYs(a) } : { x: a.x as string, y: a.y as string }),
        forceOrigin: a.origin === "yes",
      },
    }),
  },

  "logistic-regression": {
    questions: (_, table) => [
      yNames(table).length > 1 && choice("y", "Which Y data set holds the outcome, 1 or 0?", names(yNames(table))),
    ],
    finish: (a) => ({ type: "logistic-regression", params: a.y === undefined ? {} : { y: a.y as string } }),
  },

  "area-under-curve": {
    questions: () => [
      {
        id: "baseline",
        ask: "From which baseline should each data set's area be measured? Area below it counts as negative.",
        kind: "number",
        label: "Baseline Y =",
        initial: 0,
      },
    ],
    finish: (a) => ({ type: "area-under-curve", params: { baseline: a.baseline as number } }),
  },

  "nonlinear-regression": {
    questions: (a, table) => {
      const dose = a.kind !== "other";
      const models = (dose ? DOSE_MODELS : NONLINEAR_MODELS.filter((m) => !isDoseModel(m))).map(
        (m): [string, string] => [m, MODEL_LABEL[m]],
      );
      // One data set fitted can be compared with another's curve; several are each fitted.
      const ys = (a.ys as string[] | undefined) ?? yNames(table).slice(0, 1);
      const others = ys.length === 1 ? yNames(table).filter((n) => n !== ys[0]) : [];
      const midpoint = String(a.model).startsWith("inhibitor") ? "IC50" : "EC50";
      return [
        ysQuestion(table, "Which Y data sets should be fitted? Each is fitted on its own."),
        choice("kind", "Which kind of curve?", [
          ["dose", "Dose-response (sigmoidal)"],
          ["other", "Another curve (line, polynomial, exponential, Michaelis-Menten…)"],
        ]),
        choice("model", "Which curve should be fitted to X and Y?", models),
        dose &&
          others.length > 0 &&
          choice("compareWith", "Compare this curve with another data set's?", [
            ["none", "No"],
            ...others.map((n): [string, string] => [n, `Yes, with “${n}”`]),
          ]),
        dose &&
          a.compareWith !== undefined &&
          a.compareWith !== "none" &&
          choice("compare", "What should be compared?", [
            ["ec50", `Is the ${midpoint} different between the two data sets?`],
            ["all", "Does one curve fit both data sets?"],
          ]),
        // Another effective concentration, of a curve fitted on its own.
        dose &&
          (ys.length > 1 || others.length === 0 || a.compareWith === "none") &&
          choice("ecx", `Also report another effective concentration, besides the ${midpoint}?`, [
            ["none", "No"],
            ...[10, 20, 80, 90].map((f): [string, string] => [String(f), `Yes, the ${midpoint.slice(0, 2)}${f}`]),
          ]),
        // Outliers are looked for in a curve fitted on its own, not in two compared.
        (!dose || ys.length > 1 || others.length === 0 || a.compareWith === "none") &&
          choice("rout", "Identify outliers, points too far from the curve, and leave them out of the fit?", [
            ["no", "No — fit every point"],
            ["yes", "Yes — ROUT method (Q = 1%)"],
          ]),
      ];
    },
    finish: (a) => {
      const compare =
        a.kind !== "other" && a.compareWith !== undefined && a.compareWith !== "none" && fittedYs(a).ys === undefined
          ? { compareWith: a.compareWith as string, compare: a.compare as NonlinearRegressionParams["compare"] }
          : {};
      return {
        type: "nonlinear-regression",
        params: {
          ...fittedYs(a),
          model: a.model as NonlinearRegressionParams["model"],
          ...compare,
          ...(a.rout === "yes" && !compare.compareWith ? { rout: true } : {}),
          ...(a.kind !== "other" && a.ecx !== undefined && a.ecx !== "none" && !compare.compareWith
            ? { ecx: Number(a.ecx) }
            : {}),
        },
      };
    },
  },

  // A nonlinear regression whose unknowns (a Y, no X) are read off the curve; the 3PLs,
  // whose slope is fixed, aren't standard curves. Curves of X as entered first (an ELISA's
  // concentrations), those of log X after.
  interpolate: {
    questions: (_, table) => [
      choice("y", "Which Y data set holds the standards and the unknowns?", names(yNames(table))),
      choice(
        "model",
        "Which standard curve should be fitted?",
        NONLINEAR_MODELS.filter((m) => !m.includes("3pl") && !(KINETIC_MODELS as readonly string[]).includes(m))
          .sort((m, n) => Number(m.endsWith("-logx")) - Number(n.endsWith("-logx")))
          .map((m): [string, string] => [m, MODEL_LABEL[m]]),
      ),
    ],
    finish: (a) => ({
      type: "nonlinear-regression",
      params: { y: a.y as string, model: a.model as NonlinearRegressionParams["model"], interpolate: true },
    }),
  },

  "two-way-anova": {
    // One value per cell: only the ordinary ANOVA, without comparisons (see two-way-anova.ts).
    questions: (a, table) => [
      ...someSets(table, 2),
      replicated(table) &&
        choice("design", "Which two-way ANOVA? Each compares the groups, the rows and their interaction.", [
          ["ordinary", "Ordinary two-way ANOVA (parametric)"],
          ["repeated-measures", "Repeated-measures (matched by row, parametric)"],
          ["nonparametric", "Scheirer-Ray-Hare test (non-parametric)"],
        ]),
      replicated(table) &&
        a.design === "repeated-measures" &&
        choice("sphericity", "Assume sphericity (equal variability of the differences between rows)?", [
          ["no", "No — Geisser-Greenhouse correction (recommended)"],
          ["yes", "Yes — no correction"],
        ]),
      replicated(table) &&
        a.design !== "nonparametric" &&
        choice("posthoc", "Run multiple comparisons? Only meaningful if the ANOVA is significant.", [
          ["none", "No — just the ANOVA table"],
          ["tukey", "Yes — Tukey's multiple comparisons test"],
          ...(a.design === "repeated-measures"
            ? []
            : ([["dunnett", "Yes, each against a control — Dunnett's test"]] as [string, string][])),
          ["bonferroni", "Yes — Bonferroni correction"],
          ["sidak", "Yes — Šidák correction"],
          ["holm-sidak", "Yes — Holm-Šidák correction (more powerful)"],
          ["fisher", "Yes — Fisher's LSD (no correction)"],
          ...(a.design === "repeated-measures"
            ? []
            : ([["games-howell", "Yes — Games-Howell test (without assuming equal SDs)"]] as [string, string][])),
        ]),
      replicated(table) &&
        a.design !== "nonparametric" &&
        a.posthoc !== undefined &&
        a.posthoc !== "none" &&
        choice("posthocTarget", "Compare what?", [
          ["groups", "The groups within each row"],
          ["rows", "The rows within each group"],
        ]),
      a.posthoc === "dunnett" &&
        (a.posthocTarget === "rows"
          ? choice("control", "Which row is the control?", names(dataRows(table)))
          : choice("control", "Which group is the control?", names(chosenSets(a) ?? setNames(table)))),
    ],
    finish: (a) => {
      const posthoc = String(a.posthoc ?? "none");
      const posthocTarget = String(a.posthocTarget ?? "groups");
      return {
        type: "two-way-anova",
        params: withSets(a, {
          design: (a.design ?? "ordinary") as TwoWayAnovaParams["design"],
          posthoc: posthoc as TwoWayAnovaParams["posthoc"],
          posthocTarget: posthocTarget as TwoWayAnovaParams["posthocTarget"],
          ...(a.design === "repeated-measures" ? { sphericity: a.sphericity === "yes" } : {}),
          ...(posthoc === "dunnett" ? { control: a.control as string } : {}),
        }),
      };
    },
  },

  "multiple-t-tests": {
    questions: (a, table) => [
      ...twoSets(a, table),
      choice("paired", PAIRED, [
        ["unpaired", "Unpaired (independent groups)"],
        ["paired", "Paired (matched samples)"],
      ]),
      choice("gaussian", "Assume the data are sampled from a Gaussian (normal) distribution?", [
        ["yes", "Yes — t test at each row (parametric)"],
        [
          "no",
          `No — ${a.paired === "paired" ? "Wilcoxon signed-rank" : "Mann-Whitney"} test at each row (non-parametric)`,
        ],
      ]),
      a.gaussian === "yes" &&
        choice("pooled", "Assume every row has the same amount of scatter (SD)?", [
          ["no", "No — fit each row's SD independently (recommended)"],
          ["yes", "Yes — pool one shared SD across all rows"],
        ]),
      choice("correction", "Correct for running many comparisons at once?", [
        ["holm", "Holm correction (recommended)"],
        ["fdr", "False discovery rate (Benjamini-Hochberg)"],
        ["none", "None — treat each row independently"],
      ]),
    ],
    finish: (a) => ({
      type: "multiple-t-tests",
      params: withSets(a, {
        paired: a.paired === "paired",
        gaussian: a.gaussian === "yes",
        pooledSd: a.gaussian === "yes" && a.pooled === "yes",
        correction: a.correction as MultipleTTestsParams["correction"],
      }),
    }),
  },

  "correlation-matrix": {
    questions: (_, table) => [
      ...someSets(table, 2),
      choice("method", "Which correlation coefficient should be computed for every pair of variables?", [
        ["pearson", "Pearson (parametric)"],
        ["spearman", "Spearman (non-parametric)"],
      ]),
    ],
    finish: (a) => ({
      type: "correlation-matrix",
      params: withSets(a, { method: a.method as CorrelationParams["method"] }),
    }),
  },

  "multiple-regression": {
    questions: (a, table) => [
      choice("dependent", "Which variable is the dependent one (Y)?", names(dataNames(table))),
      {
        id: "predictors",
        ask: "Which variables are the predictors?",
        kind: "names",
        options: dataNames(table).filter((n) => n !== a.dependent),
      },
    ],
    finish: (a) => ({
      type: "multiple-regression",
      params: { dependent: a.dependent as string, predictors: a.predictors as string[] },
    }),
  },

  survival: {
    questions: (_, table) => {
      const groups = splitXY(table.columns).ys.length;
      return [
        choice("curveTest", "Which test should compare the survival curves?", [
          ["logrank", "Log-rank (Mantel-Cox) test (recommended)"],
          ...(groups > 2
            ? [["trend", "Log-rank test for trend — the groups are in a meaningful order"] as [string, string]]
            : []),
          ["gehan", "Gehan-Breslow-Wilcoxon test — more weight on early events"],
        ]),
        groups > 2 &&
          choice("correction", "Correct the comparisons of each pair of groups for multiple testing?", [
            ["holm", "Holm correction (recommended)"],
            ["fdr", "False discovery rate (Benjamini-Hochberg)"],
            ["none", "None — treat each pair independently"],
          ]),
      ];
    },
    finish: (a) => ({
      type: "survival",
      params: {
        curveTest: a.curveTest as SurvivalParams["curveTest"],
        correction: (a.correction ?? "holm") as SurvivalParams["correction"],
      },
    }),
  },

  cox: {
    questions: (_, table) => [
      choice(
        "reference",
        "Which group's hazard should the others be compared to?",
        names(splitXY(table.columns).ys.map((s) => s.name)),
      ),
    ],
    finish: (a) => ({ type: "cox", params: { reference: a.reference as CoxParams["reference"] } }),
  },
};
