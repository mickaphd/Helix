import { EmptyState } from "../../ui/layout";
import { useProjectStore } from "../../store/use-project-store";
import { TableView } from "../../views/tables/table-view";
import { AnalysisView } from "../../views/analyses/analysis-view";
import { GraphView } from "../../views/graphs/graph-view";
import { GRAPHS } from "../../views/graphs";

/** Shows the active node's view. */
export function Workspace() {
  const { activeNode: node } = useProjectStore();

  if (node?.type === "table" && node.data) return <TableView key={node.id} node={node} />;
  if (node?.type === "analysis" && node.analysisType) return <AnalysisView key={node.id} node={node} />;
  if (node?.type === "graph" && node.graphType) {
    if (node.graphType in GRAPHS) return <GraphView key={node.id} node={node} />;
    return <EmptyState title="Unknown graph type" description="This graph was made with a newer version of Helix." />;
  }
  return <EmptyState title="No selection" description="Create or select a Table to begin." />;
}
