// Starting an analysis: check the parent table has the data the test needs
// (otherwise a native warning, Prism-style), then open the test's wizard or run
// it. Shared by the New Analysis picker, the sidebar and the Analysis menu so
// every entry point behaves the same.
import { alert } from "../../native";
import { useProjectStore } from "../../store/use-project-store";
import { ANALYSES } from "../../stats";
import type { AnalysisParams, AnalysisPickerValue, AnalysisType } from "../../stats/types";
import { ANALYSIS_OPTIONS_BY_TABLE, countDataColumns, countDataGroups } from ".";
import { WIZARDS } from "./wizards";

/** Checks the table has at least `need` data columns; warns (naming `label`) otherwise. */
function useColumnsPrecheck() {
  const { nodes } = useProjectStore();
  return (tableId: string, need: number, label: string) => {
    const table = nodes[tableId];
    if (!table || table.type !== "table") return false;
    const have = countDataColumns(table.data);
    if (have >= need) return true;
    alert(
      `${label} needs at least ${need} columns with data.`,
      `“${table.name}” currently has ${have}. Enter data into more columns and try again.`,
    );
    return false;
  };
}

function useAnalysisPrecheck() {
  const { nodes } = useProjectStore();
  const columnsPrecheck = useColumnsPrecheck();
  return (tableId: string, testType: AnalysisType) => {
    const { label, minColumns } = ANALYSES[testType];
    if (!columnsPrecheck(tableId, minColumns, label)) return false;
    // Multiple t tests compares exactly 2 column groups per row. Count the groups
    // that hold data, not the table's structural group count.
    if (testType === "multiple-t-tests" && countDataGroups(nodes[tableId]?.data) !== 2) {
      alert(
        `${label} needs exactly 2 column groups with data.`,
        "Enter data into exactly 2 groups (or change the table's group count) and try again.",
      );
      return false;
    }
    return true;
  };
}

/** Creates the analysis node once its params are known (wizards call this). */
export function useAnalysisLauncher() {
  const { createAnalysis } = useProjectStore();
  const precheck = useAnalysisPrecheck();
  return (tableId: string, testType: AnalysisType, params?: AnalysisParams) => {
    if (precheck(tableId, testType)) createAnalysis(tableId, testType, params);
  };
}

/** Starts a test picked from the picker or the Analysis menu: opens its wizard,
 *  or runs it directly when it has no options. Returns true if a wizard opened. */
export function useStartAnalysis() {
  const { openSelector, createAnalysis } = useProjectStore();
  const columnsPrecheck = useColumnsPrecheck();
  const precheck = useAnalysisPrecheck();
  return (tableId: string, picked: AnalysisPickerValue): boolean => {
    const ready =
      picked === "compare-many-groups"
        ? columnsPrecheck(tableId, ANALYSES.anova.minColumns, "Compare more than two groups")
        : precheck(tableId, picked);
    if (!ready) return false;
    if (!WIZARDS[picked]) {
      createAnalysis(tableId, picked as AnalysisType);
      return false;
    }
    openSelector({ kind: "analysis-params", tableId, testType: picked });
    return true;
  };
}

/** Opens the New Analysis picker for the table's type, or a notice if it has no tests yet. */
export function useOpenAnalysisPicker() {
  const { nodes, openSelector } = useProjectStore();
  return (tableId: string) => {
    const type = nodes[tableId]?.tableType;
    if (type && ANALYSIS_OPTIONS_BY_TABLE[type].length > 0) openSelector({ kind: "new-analysis", tableId });
    else alert("No analyses available yet for this table type.", "", "info");
  };
}
