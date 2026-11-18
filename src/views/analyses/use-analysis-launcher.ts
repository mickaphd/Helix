// Starting an analysis: check the parent table has the data the test needs
// (otherwise a native warning, Prism-style), then open the test's wizard or run
// it. Shared by the New Analysis picker, the sidebar and the Analysis menu so
// every entry point behaves the same.
import { alert } from "../../native";
import { useProjectActions, type ForGraph } from "../../store/use-project-store";
import { ANALYSES } from "../../stats";
import type { AnalysisParams, AnalysisPickerValue, AnalysisType } from "../../stats/types";
import { countDataColumns, countDataGroups } from ".";
import { WIZARDS } from "./wizards";
import { readTable } from "../../lib/dataset";

/** Checks the table has at least `need` data columns; warns (naming `label`) otherwise. */
function useColumnsPrecheck() {
  const { get } = useProjectActions();
  return (tableId: string, need: number, label: string) => {
    const table = get().nodes[tableId];
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
  const { get } = useProjectActions();
  const columnsPrecheck = useColumnsPrecheck();
  return (tableId: string, testType: AnalysisType) => {
    const { label, minColumns } = ANALYSES[testType];
    if (!columnsPrecheck(tableId, minColumns, label)) return false;
    // Multiple t tests compares 2 column groups per row. Count the groups that hold
    // data, not the table's structural group count.
    if (testType === "multiple-t-tests" && countDataGroups(get().nodes[tableId]?.data) < 2) {
      alert(`${label} needs at least 2 column groups with data.`, "Enter data into 2 groups and try again.");
      return false;
    }
    return true;
  };
}

/** Creates the analysis node once its params are known (wizards call this). */
export function useAnalysisLauncher() {
  const { createAnalysis, get, updateGraph, setActiveNode } = useProjectActions();
  const precheck = useAnalysisPrecheck();
  return (tableId: string, testType: AnalysisType, params?: AnalysisParams, forGraph?: ForGraph) => {
    if (!precheck(tableId, testType)) return;
    const id = createAnalysis(tableId, testType, params);
    // Made for a graph's stars: chosen for it, which stays in front (its pairs to tick).
    const graph = forGraph && get().nodes[forGraph.id];
    if (graph?.graphOptions) {
      updateGraph(graph.id, { ...graph.graphOptions, sigAnalysisId: id, sigPairs: [] });
      setActiveNode(graph.id);
    }
  };
}

/** Starts a test picked from the picker or the Analysis menu: opens its wizard,
 *  or runs it directly when it has nothing to ask. Returns true if a wizard opened. */
export function useStartAnalysis() {
  const { get, openSelector } = useProjectActions();
  const launch = useAnalysisLauncher();
  const columnsPrecheck = useColumnsPrecheck();
  const precheck = useAnalysisPrecheck();
  return (tableId: string, picked: AnalysisPickerValue, forGraph?: ForGraph): boolean => {
    const ready =
      picked === "compare-many-groups"
        ? columnsPrecheck(tableId, ANALYSES.anova.minColumns, "Compare more than two groups")
        : picked === "transform"
          ? columnsPrecheck(tableId, 1, "Transform or Normalize")
          : precheck(tableId, picked === "interpolate" ? "nonlinear-regression" : picked);
    if (!ready) return false;
    // A transform always asks how.
    if (picked === "transform") {
      openSelector({ kind: "analysis-params", tableId, testType: picked });
      return true;
    }
    // A wizard with nothing to ask of this table (one data set, say) runs at once.
    const wizard = WIZARDS[picked];
    const { data, tableType } = get().nodes[tableId]!;
    const table = readTable(data!);
    if (!wizard?.questions({}, table, tableType).some(Boolean)) {
      const { type, params } = wizard?.finish({}, table, tableType) ?? { type: picked as AnalysisType };
      launch(tableId, type, params, forGraph);
      return false;
    }
    openSelector({ kind: "analysis-params", tableId, testType: picked, forGraph });
    return true;
  };
}
