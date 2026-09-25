// What the New Analysis picker and the Analysis menu offer for each table type.
// The tests themselves (name, needs, computation) are in stats/index.ts.

import { ANALYSES } from "../../stats";
import type { AnalysisPickerValue } from "../../stats/types";
import type { TableData, TableType } from "../../store/types";
import type { SelectorOption } from "../../components/common/universal-modal";
import { groupsOf, readTable } from "../../lib/dataset";

function optionsFor(order: AnalysisPickerValue[]): SelectorOption<AnalysisPickerValue>[] {
  return order.map((value) => ({
    value,
    label: value === "compare-many-groups" ? "Compare more than two groups" : ANALYSES[value].label,
  }));
}

/** Test options for the selector + menu, scoped per table type (each table's columns mean
 *  something different — a Column table's columns are independent groups, an XY table's are
 *  X + Y data series — so the tests that make statistical sense differ too) and given in a fixed
 *  logical order rather than sorted by label. ANOVA/Kruskal-Wallis and Repeated-measures
 *  ANOVA/Friedman aren't listed individually — Prism-style, one meta entry cascades to whichever
 *  the wizard's Paired?/Gaussian? answers resolve to. Shapiro-Wilk isn't listed either: it is
 *  offered as "Not sure?" on every Gaussian? question (see `normality-check.ts`). */
export const ANALYSIS_OPTIONS_BY_TABLE: Record<TableType, SelectorOption<AnalysisPickerValue>[]> = {
  column: optionsFor([
    "descriptive-statistics",
    "compare-two-groups",
    "compare-many-groups",
    "one-sample-t",
    "outliers",
  ]),
  xy: optionsFor(["correlation", "linear-regression", "area-under-curve", "nonlinear-regression"]),
  grouped: optionsFor(["two-way-anova", "multiple-t-tests"]),
  multiple: optionsFor(["correlation-matrix", "multiple-regression"]),
  contingency: optionsFor(["chi-square"]),
};

/** Count data columns (excluding the leading Title column) that hold ≥1 numeric value. */
export function countDataColumns(data: TableData | undefined): number {
  if (!data) return 0;
  return readTable(data).numeric.length;
}

/** Count Grouped-table column-groups (by "A:Y1"-style name prefix) that hold ≥1 numeric
 *  value. A table's `groups` field is structural (how many are provisioned), not how many
 *  actually have data entered — tests needing an exact data-group count must check this. */
export function countDataGroups(data: TableData | undefined): number {
  if (!data) return 0;
  return groupsOf(readTable(data).numeric).length;
}
