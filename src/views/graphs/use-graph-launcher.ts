import { alert } from "../../native";
import { useProjectStore } from "../../store/use-project-store";
import { GRAPH_OPTIONS_BY_TABLE } from ".";

/** Opens the New Graph picker for the table's type, or a notice if it has no graphs yet. */
export function useOpenGraphPicker() {
  const { nodes, openSelector } = useProjectStore();
  return (tableId: string) => {
    const type = nodes[tableId]?.tableType;
    if (type && GRAPH_OPTIONS_BY_TABLE[type].length > 0) openSelector({ kind: "new-graph", tableId });
    else alert("No graphs available yet for this table type.", "", "info");
  };
}
