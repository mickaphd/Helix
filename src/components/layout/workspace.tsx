import * as React from "react";
import { EmptyState } from "../../ui/layout";
import { useProjectStore } from "../../store/use-project-store";
import { TableView } from "../../views/tables/table-view";
import { AnalysisView } from "../../views/analyses/analysis-view";
import { GraphView } from "../../views/graphs/graph-view";
import { GRAPHS } from "../../views/graphs";
import { ANALYSES } from "../../stats";

const NEWER = "It was made with a newer version of Helix.";

/** Shows the active node's view. */
export function Workspace() {
  const { activeNode: node } = useProjectStore();

  if (node?.type === "table" && node.data) return <Shown key={node.id}><TableView node={node} /></Shown>;
  if (node?.type === "analysis" && node.analysisType) {
    if (!Object.hasOwn(ANALYSES, node.analysisType)) return <EmptyState title="Unknown analysis" description={NEWER} />;
    return <Shown key={node.id}><AnalysisView node={node} /></Shown>;
  }
  if (node?.type === "graph" && node.graphType) {
    if (!Object.hasOwn(GRAPHS, node.graphType)) return <EmptyState title="Unknown graph type" description={NEWER} />;
    return <Shown key={node.id}><GraphView node={node} /></Shown>;
  }
  return <EmptyState title="No selection" description="Create or select a Table to begin." />;
}

/** A view that fails to draw says so in its place: the rest of the window (the
 *  sidebar, the menus, Save) keeps working, so nothing is lost. */
class Shown extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.error ? <EmptyState title="This item couldn't be shown" description={this.state.error} /> : this.props.children;
  }
}
