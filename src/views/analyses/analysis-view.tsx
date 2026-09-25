// Host for an analysis node: runs the chosen test on the parent table and
// renders the result.
import type { ProjectNode } from "../../store/types";
import { useProjectStore } from "../../store/use-project-store";
import { Toolbar } from "../../ui/layout";
import { ANALYSES } from "../../stats";
import { AnalysisResultsView } from "./analysis-results-view";
import { useAnalysis } from "./use-analysis";

export function AnalysisView({ node }: { node: ProjectNode }) {
  const { nodes } = useProjectStore();
  const data = node.parentId ? nodes[node.parentId]?.data : undefined;
  const outcome = useAnalysis(node.analysisType, data, node.analysisParams);

  return (
    <>
      <Toolbar title={node.name} tag={ANALYSES[node.analysisType!].label} />
      <div className="flex-1 overflow-auto">
        {outcome && !("error" in outcome) ? (
          <AnalysisResultsView result={outcome} />
        ) : (
          <p className="px-8 py-6 text-regular text-secondary">
            {!data ? "This analysis has no source table." : (outcome?.error ?? "Running…")}
          </p>
        )}
      </div>
    </>
  );
}
