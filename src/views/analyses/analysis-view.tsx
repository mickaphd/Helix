// Host for an analysis node: runs the chosen test on the parent table and
// renders the result.
import * as React from "react";
import type { ProjectNode } from "../../store/types";
import { useProjectStore } from "../../store/use-project-store";
import { Toolbar } from "../../ui/layout";
import { isNative, setSpinner } from "../../native";
import { ANALYSES } from "../../stats";
import { titleCase } from "../../lib/format";
import { AnalysisResultsView } from "./analysis-results-view";
import { useAnalysis } from "./use-analysis";

/** While the analysis runs: macOS's spinning wheel in the middle of the results, once it
 *  has taken half a second (R or a package loading): a quick one shows none. */
function Running() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isNative) return;
    let shown = false;
    const timer = setTimeout(() => {
      const { left, top, width, height } = ref.current!.getBoundingClientRect();
      shown = true;
      setSpinner([left + width / 2, top + height / 2]);
    }, 500);
    return () => {
      clearTimeout(timer);
      if (shown) setSpinner(null);
    };
  }, []);
  return (
    <div ref={ref} className="flex h-full items-center justify-center text-regular text-secondary">
      {!isNative && "Running…"}
    </div>
  );
}

export function AnalysisView({ node }: { node: ProjectNode }) {
  const { nodes } = useProjectStore();
  const data = node.parentId ? nodes[node.parentId]?.data : undefined;
  const outcome = useAnalysis(node.analysisType, data, node.analysisParams);

  return (
    <>
      <Toolbar title={node.name} tag={titleCase(ANALYSES[node.analysisType!].label)} />
      <div className="flex-1 overflow-auto">
        {outcome && !("error" in outcome) ? (
          <AnalysisResultsView result={outcome} />
        ) : data && !outcome ? (
          <Running />
        ) : (
          <p className="px-8 py-6 text-regular text-secondary">
            {outcome?.error ?? "This analysis has no source table."}
          </p>
        )}
      </div>
    </>
  );
}
