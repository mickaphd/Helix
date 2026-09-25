// The outcome of a test on a table, for a view: runs it (runAnalysis shares one
// result per table version, so the analysis view and a graph's overlays reuse the
// same run) and re-runs it when the table or the params change.
import * as React from "react";
import { runAnalysis } from "../../stats";
import type { AnalysisOutcome, AnalysisParams, AnalysisType } from "../../stats/types";
import type { TableData } from "../../store/types";

/** null while running, or when there is nothing to run. */
export function useAnalysis(
  type: AnalysisType | undefined,
  data: TableData | undefined,
  params?: AnalysisParams,
): AnalysisOutcome | null {
  const key = `${type} ${JSON.stringify(params ?? null)}`;
  const [done, setDone] = React.useState<{ key: string; data: TableData; outcome: AnalysisOutcome } | null>(null);

  React.useEffect(() => {
    if (!type || !data) return;
    let current = true;
    void runAnalysis(type, data, params).then((outcome) => current && setDone({ key, data, outcome }));
    return () => {
      current = false;
    };
  }, [type, data, key]);

  return done && done.key === key && done.data === data ? done.outcome : null;
}
