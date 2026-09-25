import * as React from "react";
import { ProjectSidebar, SidebarToggle } from "./project-sidebar";
import { Workspace } from "./workspace";
import { useAppMenu } from "../../app-menu";
import { useDocument } from "../../store/use-document";
import { useProjectStore } from "../../store/use-project-store";
import { useLayout } from "../../store/use-layout";
import { onFullscreenChange } from "../../native";
import { UniversalModal } from "../common/universal-modal";
import { TABLE_TYPE_OPTIONS } from "../../views/tables";
import { ANALYSIS_OPTIONS_BY_TABLE } from "../../views/analyses";
import { AnalysisWizard } from "../../views/analyses/analysis-wizard";
import { useStartAnalysis } from "../../views/analyses/use-analysis-launcher";
import { GRAPH_OPTIONS_BY_TABLE } from "../../views/graphs";

// The traffic lights sit at x 20–80, centered in the 52 px toolbars (`trafficLightPosition`
// in tauri.conf.json). With the sidebar hidden, its button follows them (or starts the
// toolbar in full screen, where they're gone), and toolbars start after it.
const HIDDEN_SIDEBAR = {
  window: { button: "left-[92px]", inset: "132px" },
  fullscreen: { button: "left-3", inset: "52px" },
};

export function AppShell() {
  useAppMenu(useDocument());
  const { sidebar } = useLayout();
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => onFullscreenChange(setFullscreen), []);
  const hidden = HIDDEN_SIDEBAR[fullscreen ? "fullscreen" : "window"];
  const { nodes, selector, closeSelector, createTable, createGraph } = useProjectStore();
  const startAnalysis = useStartAnalysis();
  // The New Analysis / New Graph pickers list what fits the target table's type.
  const tableType = selector && "tableId" in selector ? (nodes[selector.tableId]?.tableType ?? "column") : "column";

  return (
    <div className="flex h-full">
      {!sidebar && <SidebarToggle className={`fixed top-3 z-10 ${hidden.button}`} />}
      <ProjectSidebar />
      <main
        className="flex min-w-0 flex-1 flex-col"
        style={{ "--toolbar-inset": sidebar ? "16px" : hidden.inset } as React.CSSProperties}
      >
        <Workspace />
      </main>

      <UniversalModal
        open={selector?.kind === "new-table"}
        title="New Table"
        description="Choose a data table type."
        options={TABLE_TYPE_OPTIONS}
        onSelect={(type) => {
          createTable(type);
          closeSelector();
        }}
        onClose={closeSelector}
      />

      <UniversalModal
        open={selector?.kind === "new-analysis"}
        title="New Analysis"
        description="Choose a statistical test."
        options={ANALYSIS_OPTIONS_BY_TABLE[tableType]}
        onSelect={(type) => {
          // A test with options moves on to its wizard; otherwise the picker is done.
          if (selector?.kind === "new-analysis" && startAnalysis(selector.tableId, type)) return;
          closeSelector();
        }}
        onClose={closeSelector}
      />

      <AnalysisWizard />

      <UniversalModal
        open={selector?.kind === "new-graph"}
        title="New Graph"
        description="Choose a graph type."
        options={GRAPH_OPTIONS_BY_TABLE[tableType]}
        onSelect={(type) => {
          if (selector?.kind === "new-graph") createGraph(selector.tableId, type);
          closeSelector();
        }}
        onClose={closeSelector}
      />
    </div>
  );
}
