// The table types (Prism's data tables). All share one grid; a type decides
// its default columns and how new columns are named (see table-data.ts).
import type { TableData, TableType } from "../../store/types";
import { newGroupedTable, newTable } from "./table-data";

interface TableModule {
  label: string;
  defaultData: () => TableData;
}

export const TABLES: Record<TableType, TableModule> = {
  // Each column is a group, each row a replicate.
  column: { label: "Column", defaultData: () => newTable("column", 15) },
  // X, then Y series.
  xy: { label: "XY", defaultData: () => newTable("xy", 16) },
  // Groups (A, B…) of replicate sub-columns ("A:Y1"…), nested headers.
  grouped: { label: "Grouped", defaultData: () => newGroupedTable(4, 3) },
  // Each column is a variable, each row a subject.
  multiple: { label: "Multiple Variables", defaultData: () => newTable("multiple", 15) },
  // Counts: row categories × outcomes.
  contingency: { label: "Contingency", defaultData: () => newTable("contingency", 15) },
};

export const TABLE_TYPE_OPTIONS = (Object.keys(TABLES) as TableType[]).map((value) => ({
  value,
  label: TABLES[value].label,
}));
