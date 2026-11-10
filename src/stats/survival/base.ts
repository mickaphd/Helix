// What both survival analyses read of a Survival table: each group holding subjects, with
// their times and codes, checked (1 = event, 0 = censored; no negative time).
import type { Column } from "../types";
import { pairUp, splitXY, xyProblem } from "../../lib/dataset";

interface SurvivalGroup {
  name: string;
  /** Each subject's time… */
  x: number[];
  /** …and code: 1, an event; 0, censored. */
  y: number[];
}

/** The groups holding subjects, at least 2, or what is wrong with the table. */
export function survivalGroups(columns: Column[]): SurvivalGroup[] | { error: string } {
  const { x, ys } = splitXY(columns);
  if (!x) return { error: xyProblem(columns)! };
  const groups = ys.map((y) => ({ name: y.name, ...pairUp(x, y) })).filter((g) => g.y.length > 0);
  for (const g of groups) {
    const code = g.y.find((c) => c !== 0 && c !== 1);
    if (code !== undefined)
      return { error: `“${g.name}” holds ${code}: enter 1 for an event, 0 for a censored subject.` };
    if (g.x.some((t) => t < 0)) return { error: "Times can't be negative." };
  }
  if (groups.length < 2) return { error: "This analysis compares at least 2 groups holding subjects." };
  return groups;
}
