// What an analysis ran on, shown first in its results: its data sets (each with its count,
// R's where the result has one), how they are compared, and the table's data sets it left
// out. Read from the result and the params, the same for every analysis.
import type { Dataset } from "../../lib/dataset";
import type { AnalysisParams, AnalysisResult, AnalysisType, Analyzed } from "../types";

/** The analyses of a table with an X (its first data column): X is never one of its data sets. */
const ON_X = new Set<AnalysisType>([
  "linear-regression",
  "logistic-regression",
  "nonlinear-regression",
  "area-under-curve",
  "survival",
  "cox",
]);

type Params = Record<string, unknown> | undefined;
const quoted = (name: string) => `“${name}”`;
/** “A”, “B” and “C”. */
const and = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");

export function analyzedOf(
  type: AnalysisType,
  params: AnalysisParams | undefined,
  table: Dataset,
  result: AnalysisResult,
): Analyzed | undefined {
  const p = params as Params;
  const withX = ON_X.has(type) || (type === "correlation" && (p?.mode ?? "x-vs-every-y") === "x-vs-every-y");
  const xName = table.sets[0]?.name;
  // The table's data sets holding numbers (an X aside).
  const all = table.sets
    .filter((s, i) => !(withX && i === 0) && s.columns.some((c) => c.values.length > 0))
    .map((s) => s.name);
  const make = (sets: Analyzed["sets"], how: Analyzed["how"] = "list", detail?: string): Analyzed => ({
    sets,
    how,
    ...(detail ? { detail } : {}),
    left: all.filter((n) => !sets.some((s) => s.name === n)),
  });
  const described = result.groups.map((g) => ({ name: g.name, n: g.n }));
  const stat = (label: string) => result.stats.find((s) => s.label === label)?.value;

  switch (type) {
    case "compare-two-groups": {
      const paired = p?.paired === true;
      return make(described, paired ? "paired" : "vs", paired ? `${described[0]?.n ?? 0} pairs` : undefined);
    }
    case "one-sample-t":
      return make(described, "list", `each against ${p?.hypotheticalValue ?? 0}`);
    case "anova":
    case "kruskal-wallis": {
      const control = p?.posthoc === "dunnett" ? (p.control as string | undefined) : undefined;
      const sets = control
        ? [...described.filter((g) => g.name === control), ...described.filter((g) => g.name !== control)]
        : described;
      return make(sets, control ? "control" : "list");
    }
    case "rm-anova":
    case "friedman": {
      const missing = stat("Missing values");
      return make(
        described,
        "list",
        missing === undefined
          ? `${described[0]?.n ?? 0} subjects, each in every one`
          : `${stat("Subjects")} subjects, ${missing} value${missing === 1 ? "" : "s"} missing`,
      );
    }
    case "descriptive-statistics":
      return make(described);
    case "shapiro-wilk":
      return make((result.normality ?? []).map((r) => ({ name: r.group })));
    case "outliers":
      return make((result.outlierGroups ?? []).map((g) => ({ name: g.group, n: g.points })));
    case "two-way-anova": {
      const rows = table.titles.filter((_, r) =>
        table.columns.some((c) => c.set !== undefined && described.some((g) => g.name === c.set) && c.byRow[r] != null),
      ).length;
      return make(described, "list", `${rows} rows`);
    }
    case "multiple-t-tests":
      return make(described, "vs", `${stat("Rows compared") ?? 0} rows, each compared`);
    case "correlation": {
      if (result.matrix) return make(result.matrix.variables.map((name) => ({ name })));
      if (result.correlations)
        return make(
          result.correlations.map((c) => ({ name: c.variable })),
          "list",
          `each with ${quoted(xName ?? "X")}`,
        );
      return make(described, "vs");
    }
    case "correlation-matrix":
      return make((result.matrix?.variables ?? []).map((name) => ({ name })));
    case "linear-regression":
    case "nonlinear-regression": {
      // On X: a Multiple Variables table's chosen one, else the table's.
      const x = (p?.x as string | undefined) ?? xName ?? "X";
      if (result.fit) {
        const n = result.fit.rows.find((r) => r.label === "N")?.values;
        return make(
          result.fit.sets.map((name, i) => ({ name, n: n?.[i] ?? undefined })),
          "list",
          `on ${quoted(x)}`,
        );
      }
      const y = described[1];
      return y ? make([y], "list", `on ${quoted(described[0].name)}`) : undefined;
    }
    case "logistic-regression": {
      const y = (p?.y as string | undefined) ?? described[1]?.name ?? all[0];
      return make([{ name: y, n: stat("N") ?? undefined }], "list", `on ${quoted(xName ?? "X")}`);
    }
    case "area-under-curve":
      return make(
        (result.areas ?? []).map((a) => ({ name: a.variable, n: a.n })),
        "list",
        `over ${quoted(xName ?? "X")}`,
      );
    case "multiple-regression": {
      const [dependent, ...predictors] = described;
      if (!dependent) return undefined;
      return {
        ...make(
          [dependent],
          "list",
          `explained by ${and(predictors.map((g) => quoted(g.name)))}, on ${stat("Complete rows (n)")} complete rows`,
        ),
        left: all.filter((n) => !described.some((g) => g.name === n)),
      };
    }
    case "chi-square": {
      const rows = table.titles.filter((_, r) => table.columns.some((c) => c.byRow[r] != null)).length;
      return make(
        all.map((name) => ({ name })),
        "list",
        `counted in ${rows} rows`,
      );
    }
    case "survival":
      return make(
        (result.survivalGroups ?? []).map((g) => ({ name: g.group, n: g.subjects })),
        (result.survivalGroups?.length ?? 0) === 2 ? "vs" : "list",
        "subjects followed over time",
      );
    case "cox": {
      const others = (result.hazardRatios ?? []).map((h) => h.comparison.split(" vs. ")[0]);
      const reference = result.hazardRatios?.[0]?.comparison.split(" vs. ")[1];
      return reference
        ? make(
            [reference, ...others].map((name) => ({ name })),
            "control",
          )
        : undefined;
    }
  }
}
