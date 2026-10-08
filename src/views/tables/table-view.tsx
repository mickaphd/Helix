// A data table: the grid, and (grouped tables) the Groups panel. Every edit goes to
// the project store, which keeps the Undo history for the whole project.
import { GROUPED_LIMITS, type ProjectNode, type TableData } from "../../store/types";
import type { TableMove } from "../../store/references";
import { useProjectActions } from "../../store/use-project-store";
import { Section, Stepper, WithInspector } from "../../components/common/inspector";
import { useLayout } from "../../store/use-layout";
import { ColumnsIcon } from "@phosphor-icons/react";
import { Toolbar } from "../../ui/layout";
import { Grid } from "./grid";
import { regroupLoses, regroupTable } from "./table-data";
import { isGrouped } from "../../lib/dataset";
import { seriesKeyOf } from "../../lib/columns";
import { confirmDelete } from "../../native";
import { TABLES } from ".";

// ── View ───────────────────────────────────────────────────────────────

export function TableView({ node }: { node: ProjectNode }) {
  const data = node.data!;
  const { updateTable } = useProjectActions();
  const update = (next: TableData, label: string, move?: TableMove) => {
    if (next !== data) updateTable(node.id, next, label, move);
  };
  const { setLayout } = useLayout();
  const tag = TABLES[node.tableType ?? "column"].label;
  const grid = (
    <Grid
      data={data}
      type={node.tableType ?? "column"}
      update={update}
      showGroups={() => setLayout({ inspector: true })}
    />
  );

  // Only a grouped table has settings of its own: its groups.
  if (!isGrouped(data)) {
    return (
      <>
        <Toolbar title={node.name} tag={tag} />
        {grid}
      </>
    );
  }
  return (
    <WithInspector title={node.name} tag={tag} inspector={<GroupsPanel data={data} update={update} />}>
      {grid}
    </WithInspector>
  );
}

/** A grouped table's structure: groups and sub-columns per group, each change at once.
 *  Taking away a group or sub-column that holds values asks first (Undo brings it back). */
function GroupsPanel({ data, update }: { data: TableData; update: (next: TableData, label: string) => void }) {
  const groups = data.groups!;
  const replicates = data.replicates!;
  const regroup = async (g: number, r: number) => {
    if (regroupLoses(data, g, r)) {
      const [what, its] =
        g < groups
          ? [`group “${seriesKeyOf(data.columns.at(-1)!)}”`, "Its"]
          : [`sub-column ${replicates} of each group`, "Their"];
      if (!(await confirmDelete(`Delete ${what}?`, `${its} values will be deleted too. You can undo this.`))) return;
    }
    update(regroupTable(data, g, r), "Change Groups");
  };
  return (
    <Section title="Groups" icon={<ColumnsIcon />}>
      <Stepper
        label="Groups"
        value={groups}
        {...GROUPED_LIMITS.groups}
        step={1}
        onChange={(g) => void regroup(g, replicates)}
      />
      <Stepper
        label="Sub-columns"
        value={replicates}
        {...GROUPED_LIMITS.replicates}
        step={1}
        onChange={(r) => void regroup(groups, r)}
      />
    </Section>
  );
}
