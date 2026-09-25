// Analyses and graphs name the columns and groups they use: a regression's Y, a
// multiple regression's variables, a dose-response curve's data set, a volcano's
// columns or groups, the comparisons drawn as stars. When the table renames one,
// its analyses and graphs follow, so they keep working on the same data.
import type { AnalysisParams } from "../stats/types";
import type { GraphOptions, ProjectNode } from "./types";
import { pairKey, pairOf } from "../views/graphs/significance-overlay";

// The params and options holding names (a name, or a list of names).
const PARAM_NAMES = ["y", "dependent", "predictors", "datasets"] as const;
const OPTION_NAMES = ["doseY", "volcanoX", "volcanoY", "volcanoLabel", "volcanoGroupA", "volcanoGroupB"] as const;

/** `node` with the names in `renamed` (old → new) replaced. */
export function renameReferences(node: ProjectNode, renamed: Record<string, string>): ProjectNode {
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
    return { ...node, graphOptions: options };
  }
  return node;
}
