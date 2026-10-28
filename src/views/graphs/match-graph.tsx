// The Format panel's Match section: a graph takes what the user switches on of another
// graph of the project, its example (Prism's Magic), in the panel's order; a property
// that would change nothing is grayed. Series take the example's styles in order: the
// first series the first's, and so on.
import * as React from "react";
import { CaretUpDownIcon, MagicWandIcon } from "@phosphor-icons/react";
import { Button } from "../../ui/controls";
import { Row, Section } from "../../components/common/inspector";
import { popupMenu } from "../../native";
import { separator } from "../../menus";
import { useOutline, useProjectStore, type OutlineNode } from "../../store/use-project-store";
import { paletteOf } from "../../lib/palettes";
import {
  DEFAULT_GRAPH_OPTIONS,
  type GraphOptions,
  type GraphType,
  type ProjectNode,
  type SeriesStyle,
} from "../../store/types";
import { GRAPHS, graphSeries } from ".";
import { Toggle } from "./panel-controls";

interface Property {
  id: string;
  label: string;
  keys?: (keyof GraphOptions)[];
  series?: (keyof SeriesStyle)[];
  /** Off until the user switches it on once. */
  off?: boolean;
}

// prettier-ignore
const PROPERTIES: Property[] = [
  { id: "points", label: "Points", keys: ["pointSize", "pointShape", "pointFill", "pointOutline", "pointOutlineColor"] },
  { id: "shapes", label: "Fill and outline", keys: ["fill", "outline", "outlineColor", "barGap"] },
  { id: "lines", label: "Lines", keys: ["lineWidth", "lineDash"] },
  { id: "errors", label: "Error bars", keys: ["errorWidth", "errorCaps", "errorColor", "errorDirection"] },
  { id: "colors", label: "Colors", keys: ["palette"], series: ["color"] },
  { id: "marks", label: "Series marks", series: ["shape", "dash", "pattern"] },
  { id: "styled", label: "Points styled one by one", keys: ["points"], off: true },
  { id: "text", label: "Text size and spacing", keys: ["fontSize", "xTitleGap", "yTitleGap"] },
  { id: "titles", label: "Titles", keys: ["title", "xLabel", "yLabel"], off: true },
  { id: "ranges", label: "Axis ranges", keys: ["xMin", "xMax", "xStep", "yMin", "yMax", "yStep"], off: true },
  { id: "axes", label: "Axis thickness", keys: ["axisWidth"] },
  { id: "sheet", label: "Size and background", keys: ["width", "height", "background"] },
];

/** A graph as matching sees it: its type, its table, its options and its series. */
export interface Matched {
  type: GraphType;
  table: string;
  options: GraphOptions;
  series: string[];
}

/** `target`'s options with the properties `ids` of `example`. Left out: a palette that
 *  isn't a gradient for a heatmap, points styled one by one from another table. */
export function matched(target: Matched, example: Matched, ids: string[]): GraphOptions {
  const picked = PROPERTIES.filter((p) => ids.includes(p.id));
  const takes = (k: keyof GraphOptions) =>
    k === "points"
      ? target.table === example.table
      : k !== "palette" ||
        GRAPHS[target.type].family !== "heatmap" ||
        paletteOf(example.options).kind !== "categorical";
  const keys = picked.flatMap((p) => p.keys ?? []).filter(takes);
  const options: GraphOptions = { ...target.options };
  for (const k of keys)
    Object.assign(options, { [k]: k === "palette" ? paletteOf(example.options) : example.options[k] });
  const fields = picked.flatMap((p) => p.series ?? []);
  if (fields.length) {
    const series = { ...target.options.series };
    target.series.forEach((name, i) => {
      const theirs: SeriesStyle = example.options.series?.[example.series[i]] ?? {};
      const own = { ...series[name] };
      for (const f of fields) Object.assign(own, { [f]: theirs[f] });
      const style = Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined));
      if (Object.keys(style).length) series[name] = style;
      else delete series[name];
    });
    options.series = Object.keys(series).length ? series : undefined;
  }
  return options;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether taking property `p` of `example` changes `target`. */
function changes(p: Property, target: Matched, example: Matched) {
  const next = matched(target, example, [p.id]);
  return (
    (p.keys ?? []).some((k) => !same(next[k], target.options[k])) ||
    (!!p.series && !same(next.series, target.options.series))
  );
}

// The properties last switched on, this Mac's (local storage); at first, all but the `off` ones.
const TICKED_KEY = "helix.graph.match";
const USUAL = PROPERTIES.filter((p) => !p.off).map((p) => p.id);
function readTicked(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(TICKED_KEY) ?? "null");
    return Array.isArray(saved) ? saved : USUAL;
  } catch {
    return USUAL;
  }
}

/** The project's other graphs Helix can draw, under their table, in sidebar order: the
 *  examples a graph can take after (one from a newer Helix can't be read, so can't be one). */
export const examplesFor = (
  graphId: string,
  tables: (OutlineNode & { children: OutlineNode[] })[],
  nodes: Record<string, ProjectNode>,
) =>
  tables
    .map((t) => ({
      table: t.name,
      graphs: t.children.filter((c) => c.id !== graphId && Object.hasOwn(GRAPHS, nodes[c.id]?.graphType ?? "")),
    }))
    .filter((t) => t.graphs.length);

/** The Match section, left out while the project has no other graph. */
export function MatchSection({
  graphId,
  set,
  ...fold
}: {
  graphId: string;
  set: (options: GraphOptions) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { nodes } = useProjectStore();
  const { tables } = useOutline();
  const [exampleId, setExampleId] = React.useState<string | null>(null);
  const [ticked, setTicked] = React.useState(readTicked);

  const others = examplesFor(graphId, tables, nodes);
  if (!others.length) return null;

  const asMatched = (node: ProjectNode): Matched => {
    const table = nodes[node.parentId!];
    return {
      type: node.graphType!,
      table: table.id,
      options: { ...DEFAULT_GRAPH_OPTIONS, ...node.graphOptions },
      series: graphSeries(node.graphType!, table.data!, table.tableType!),
    };
  };
  const target = asMatched(nodes[graphId]);
  const exampleNode = exampleId ? nodes[exampleId] : undefined; // none once deleted
  const example = exampleNode && asMatched(exampleNode);
  const offered = example ? PROPERTIES.filter((p) => changes(p, target, example)).map((p) => p.id) : [];
  const chosen = ticked.filter((id) => offered.includes(id));
  const tick = (id: string, on: boolean) => {
    const next = on ? [...ticked, id] : ticked.filter((t) => t !== id);
    setTicked(next);
    try {
      localStorage.setItem(TICKED_KEY, JSON.stringify(next));
    } catch {
      // Not kept: the next time starts from the usual ones.
    }
  };
  const choose = () =>
    popupMenu(
      others.flatMap(({ table, graphs }, i) => [
        ...(i > 0 ? [separator] : []),
        { text: table, enabled: false },
        ...graphs.map((g) => ({ text: g.name, checked: g.id === exampleId, action: () => setExampleId(g.id) })),
      ]),
    );

  return (
    <Section title="Match" icon={<MagicWandIcon />} {...fold}>
      <Row label="Graph">
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-md bg-control px-2 text-regular"
          onClick={() => void choose()}
        >
          <span className="truncate">{exampleNode?.name ?? "Choose…"}</span>
          <span className="flex-1" />
          <CaretUpDownIcon className="size-3.5 shrink-0 text-secondary" />
        </button>
      </Row>
      {example && (
        <>
          {PROPERTIES.map((p) => (
            <Toggle
              key={p.id}
              label={p.label}
              checked={offered.includes(p.id) && ticked.includes(p.id)}
              disabled={!offered.includes(p.id)}
              onChange={(on) => tick(p.id, on)}
            />
          ))}
          <Button variant="accent" disabled={!chosen.length} onClick={() => set(matched(target, example, chosen))}>
            Apply
          </Button>
        </>
      )}
    </Section>
  );
}
