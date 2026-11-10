// Analyses and graphs name the columns and groups they use: the data sets an analysis
// runs on, a regression's Y, a multiple regression's variables, a scatter's variables, a
// volcano's columns or groups, the comparisons drawn as stars, the
// series styled by hand, and the points styled one by one (by column and row). When a
// table edit renames a column or group, or moves rows, its analyses and graphs follow,
// so they keep working on the same data.
import type { AnalysisParams } from "../stats/types";
import type { GraphOptions, ProjectNode } from "./types";
import { pairKey, pairOf, parsePointKey, pointKeyOf, seriesKeyOf } from "../lib/columns";

/** What a table edit moved: the columns or groups it renamed (old → new), and where
 *  each row went (`rows(r)`; null when it was deleted). */
export interface TableMove {
  renamed?: Record<string, string>;
  rows?: (row: number) => number | null;
}

// The params and options holding names (a name, or a list of names).
const PARAM_NAMES = [
  "y",
  "dependent",
  "reference",
  "control",
  "compareWith",
  "predictors",
  "datasets",
  "sets",
] as const;
// prettier-ignore
const OPTION_NAMES = ["xVariable", "yVariable", "volcanoX", "volcanoY", "volcanoLabel", "volcanoGroupA", "volcanoGroupB"] as const;

/** `node` following a table edit's `move`; `columns`: the table's columns after it (a
 *  point in a column that is gone loses its style). */
export function followTable(node: ProjectNode, { renamed = {}, rows }: TableMove, columns: string[]): ProjectNode {
  const to = (name: string) => renamed[name] ?? name;
  const rename = (v: unknown) => (typeof v === "string" ? to(v) : Array.isArray(v) ? v.map(to) : v);
  const withNames = <T extends object>(obj: T, keys: readonly string[]) => {
    const out = { ...obj } as Record<string, unknown>;
    for (const k of keys) if (out[k] !== undefined) out[k] = rename(out[k]);
    return out as T;
  };

  if (node.analysisParams) {
    return { ...node, analysisParams: withNames<AnalysisParams>(node.analysisParams, PARAM_NAMES) };
  }
  if (node.graphOptions) {
    const options = withNames<GraphOptions>(node.graphOptions, OPTION_NAMES);
    options.sigPairs = options.sigPairs?.map((key) => {
      const [a, b] = pairOf(key);
      return pairKey(to(a), to(b));
    });
    if (options.series) options.series = Object.fromEntries(Object.entries(options.series).map(([k, v]) => [to(k), v]));
    if (options.points) options.points = movePoints(options.points, to, rows, columns);
    return { ...node, graphOptions: options };
  }
  return node;
}

/** Point styles under their new keys: a renamed column, or a grouped table's column
 *  in a renamed group ("A:Y1" when A is renamed), whichever the table has (a column of
 *  another table may hold ":" too: "Dose: 5"), and a moved row. Those of a deleted row
 *  or column go. A key with no column names a whole row (a volcano's gene). */
function movePoints<T>(
  points: Record<string, T>,
  to: (name: string) => string,
  rows: ((row: number) => number | null) | undefined,
  columns: string[],
) {
  const moved: Record<string, T> = {};
  for (const [key, style] of Object.entries(points)) {
    const { column, row } = parsePointKey(key);
    const group = seriesKeyOf(column);
    const name =
      column === "" ? "" : [to(column), to(group) + column.slice(group.length)].find((n) => columns.includes(n));
    const at = rows ? rows(row) : row;
    if (at !== null && name !== undefined) moved[pointKeyOf(name, at)] = style;
  }
  return Object.keys(moved).length ? moved : undefined;
}
