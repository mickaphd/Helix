// The questions each analysis asks before it runs, as Prism does: one question per
// step, each answer choosing the next question. A wizard only declares its questions
// and how the answers make the test's params; analysis-wizard.tsx asks them.
// A test without an entry here runs as soon as it is picked.
import { DOSE_MODELS, KINETIC_MODELS, NONLINEAR_MODELS, ROUT_Q } from "../../stats/types";
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
  TwoWayAnovaParams,
  XYCorrelationParams,
} from "../../stats/types";
import { splitXY, type Dataset } from "../../lib/dataset";
import type { TableType } from "../../store/types";

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

/** The names ticked once `name` is ticked (`on`) or not: always in `options`' order,
 *  the table's, whatever order they were clicked in. */
export const toggled = (options: string[], ticked: string[], name: string, on: boolean) =>
  options.filter((n) => (n === name ? on : ticked.includes(n)));

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

export const WIZARDS: Partial<Record<AnalysisPickerValue, Wizard>> = {
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
                ["bonferroni", "Yes, every pair — Bonferroni-corrected comparisons"],
                ...(anova
                  ? [["dunnett", "Yes, each group against a control — Dunnett's test"] as [string, string]]
                  : []),
              ];
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
          choice("equalSd", "Assume the groups have equal SDs?", [
            ["yes", "Yes — ordinary one-way ANOVA"],
            ["no", "No — Welch's ANOVA"],
          ]),
        paired &&
          a.gaussian === "yes" &&
          choice("sphericity", "Assume sphericity (equal variability of the differences between groups)?", [
            ["no", "No — Geisser-Greenhouse correction (recommended)"],
            ["yes", "Yes — no correction"],
          ]),
        choice("posthoc", paired ? "Compare the matched groups?" : "Compare the groups?", posthocs),
        a.posthoc === "dunnett" &&
          choice("control", "Which group is the control?", names(chosenSets(a) ?? setNames(table))),
      ];
    },
    finish: (a) => {
      const paired = a.paired === "paired";
      const type = a.gaussian === "yes" ? (paired ? "rm-anova" : "anova") : paired ? "friedman" : "kruskal-wallis";
      const anova = type === "anova" && {
        equalSd: a.equalSd !== "no",
        ...(a.posthoc === "dunnett" ? { control: a.control as string } : {}),
      };
      const rm = type === "rm-anova" && { sphericity: a.sphericity === "yes" };
      return { type, params: withSets(a, { posthoc: a.posthoc, ...anova, ...rm }) as AnalysisParams };
    },
  },

  "one-sample-t": {
    questions: (a, table) => {
      const center = a.gaussian === "yes" ? "mean" : "median";
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
          ["tukey groups", "Yes — Tukey's, comparing groups within each row"],
          ["tukey rows", "Yes — Tukey's, comparing rows within each group"],
          ["bonferroni groups", "Yes — Bonferroni, comparing groups within each row"],
          ["bonferroni rows", "Yes — Bonferroni, comparing rows within each group"],
        ]),
    ],
    finish: (a) => {
      const [posthoc, posthocTarget = "groups"] = String(a.posthoc ?? "none").split(" ");
      return {
        type: "two-way-anova",
        params: withSets(a, {
          design: (a.design ?? "ordinary") as TwoWayAnovaParams["design"],
          posthoc: posthoc as TwoWayAnovaParams["posthoc"],
          posthocTarget: posthocTarget as TwoWayAnovaParams["posthocTarget"],
          ...(a.design === "repeated-measures" ? { sphericity: a.sphericity === "yes" } : {}),
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
