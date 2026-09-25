// A data table: the grid, and (grouped tables) the Groups panel. Every edit goes to
// the project store, which keeps the Undo history for the whole project.
import * as React from "react";
import type { ProjectNode, TableData } from "../../store/types";
import { useProjectStore } from "../../store/use-project-store";
import { Section, Row, WithInspector } from "../../components/common/inspector";
import { useLayout } from "../../store/use-layout";
import { Button, Input } from "../../ui/controls";
import { Toolbar } from "../../ui/layout";
import { Grid } from "./grid";
import { isGrouped, regroupTable } from "./table-data";
import { TABLES } from ".";

// ── View ───────────────────────────────────────────────────────────────

export function TableView({ node }: { node: ProjectNode }) {
  const data = node.data!;
  const { updateTable } = useProjectStore();
  const update = (next: TableData, label: string, renamed?: Record<string, string>) => {
    if (next !== data) updateTable(node.id, next, label, renamed);
  };
  const { setLayout } = useLayout();
  const tag = TABLES[node.tableType ?? "column"].label;
  const grid = (
    <Grid
      data={data}
      type={node.tableType ?? "column"}
      update={update}
      configure={() => setLayout({ inspector: true })}
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

/** A grouped table's structure: groups and sub-columns per group. */
function GroupsPanel({ data, update }: { data: TableData; update: (next: TableData, label: string) => void }) {
  const fromData = () => ({ groups: data.groups!, replicates: data.replicates! });
  const [cfg, setCfg] = React.useState(fromData);
  React.useEffect(() => setCfg(fromData()), [data]);
  const count = (label: string, key: "groups" | "replicates", max: number) => (
    <Row label={label}>
      <Input
        type="number"
        min={1}
        max={max}
        value={cfg[key]}
        onChange={(e) => setCfg({ ...cfg, [key]: e.target.valueAsNumber })}
      />
    </Row>
  );
  const clamp = (v: number, max: number) => Math.max(1, Math.min(max, Math.floor(v) || 1));

  return (
    <Section title="Groups">
      {count("Groups", "groups", 200)}
      {count("Sub-columns per group", "replicates", 20)}
      <Button
        variant="accent"
        onClick={() => update(regroupTable(data, clamp(cfg.groups, 200), clamp(cfg.replicates, 20)), "Change Groups")}
      >
        Apply
      </Button>
    </Section>
  );
}
