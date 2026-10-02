/// <reference types="node" />
// Checks for what must never break: .hlx files opening across versions (with their
// colors), table edits keeping every value where it belongs, analyses and graphs
// following renamed columns, and the palettes keeping their authors' colors.
// `npm test` runs them.
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { parseProjectFile, serializeProjectFile, type ProjectFilePayload } from "../src/lib/project-file";
import { DEFAULT_GRAPH_OPTIONS, SAME_AS_FILL, type GraphOptions, type ProjectNode, type TableData } from "../src/store/types";
import { freshColumnNames, newGroupedTable, regroupTable, renameGroup, rowsDeleted, rowsInserted, writeBlock } from "../src/views/tables/table-data";
import { followTable } from "../src/store/references";
import { pairKey } from "../src/lib/columns";
import { NAMED_COLORS, PALETTES, paletteNamed, paletteOf, reversedPalette, withOpacity, withoutColors } from "../src/lib/palettes";
import { GRAPHS, newGraphOptions, type GraphFigure } from "../src/views/graphs";
import { readTable } from "../src/lib/dataset";
import { addNote, movedText, paintOf, visibleOutline, withCaps } from "../src/views/graphs/plot-helpers";
import { drawnKeys, drawnStyle, keysOf, picked, pointLabels, resizePoints, selectionRing, stylePoints, withoutSelection } from "../src/views/graphs/selection";
import { genesNamed } from "../src/views/graphs/volcano";
import { computeGroupedDEG } from "../src/lib/deg";
import { runAnalysis } from "../src/stats";
import { makeInitialState, reducer } from "../src/store/use-project-store";
import { isNewer } from "../src/lib/version";
import { withDpi } from "../src/lib/image-dpi";
import { crc32 } from "node:zlib";
import type { AnalysisParams } from "../src/stats/types";

const checks: [string, () => void | Promise<void>][] = [];
const check = (name: string, fn: () => void | Promise<void>) => checks.push([name, fn]);

const read = (text: string) => {
  const result = parseProjectFile(JSON.parse(text));
  if ("error" in result) throw new Error(result.error);
  return result;
};

const table: ProjectNode = {
  id: "t1",
  type: "table",
  name: "Doses",
  parentId: null,
  tableType: "xy",
  data: {
    columns: ["Title", "X", "Y1"],
    rows: [["a", "1", "2.5"], [null, "2", null]],
    excluded: ["0,2"],
  },
};
const analysis: ProjectNode = {
  id: "a1",
  type: "analysis",
  name: "Fit",
  parentId: "t1",
  analysisType: "linear-regression",
  analysisParams: { y: "Y1", forceOrigin: true },
};
const graph: ProjectNode = {
  id: "g1",
  type: "graph",
  name: "Plot",
  parentId: "t1",
  graphType: "xy-scatter",
  graphOptions: {
    ...newGraphOptions("xy-scatter"),
    title: "My Title",
    yMax: 10,
    regAnalysisId: "a1",
    series: { Y1: { color: "#D55E00" } },
    points: { "Y1#0": { color: "#0072B2", size: 10 } },
  },
};
const payload: ProjectFilePayload = {
  nodes: { t1: table, a1: analysis, g1: graph },
  rootOrder: ["t1"],
  childOrder: { t1: ["g1", "a1"] },
  activeNodeId: "g1",
};

// ── .hlx files ───────────────────────────────────────────────────────────

check("a saved project reads back identical", () => {
  const { project, issues } = read(serializeProjectFile(payload));
  deepStrictEqual(project, payload);
  deepStrictEqual(issues, []);
});

check("only the project is saved (no app state, no file path)", () => {
  const withState = { ...payload, filePath: "/Users/someone/secret.hlx", isDirty: true, activeNode: table };
  const file = JSON.parse(serializeProjectFile(withState));
  deepStrictEqual(Object.keys(file.project).sort(), ["activeNodeId", "childOrder", "nodes", "rootOrder"]);
});

check("a table row is written on one line", () => {
  ok(serializeProjectFile(payload).includes(`["a", "1", "2.5"]`.replace(/, /g, ",")));
});

check("names and choices are read whatever their case", () => {
  const text = serializeProjectFile(payload)
    .replace(`"tableType": "xy"`, `"TableType": "XY"`)
    .replace(`"graphOptions"`, `"GRAPHOPTIONS"`)
    .replace(`"center": "mean"`, `"Center": "Median"`)
    .replace(`"app": "helix"`, `"App": "Helix"`)
    .replace(`"title": "My Title"`, `"Title": "My Title"`);
  const { project } = read(text);
  strictEqual(project.nodes.t1.tableType, "xy");
  strictEqual(project.nodes.g1.graphOptions!.center, "median");
  strictEqual(project.nodes.g1.graphOptions!.title, "My Title"); // the user's text keeps its case
  ok(!("GRAPHOPTIONS" in project.nodes.g1));
});

check("fields from a newer version are kept when saving again", () => {
  const file = JSON.parse(serializeProjectFile(payload));
  file.project.nodes.t1.futureNote = "hello";
  file.project.nodes.t1.data.futureLayout = { a: 1 };
  file.project.nodes.g1.graphOptions.futureOption = true;
  const again = JSON.parse(serializeProjectFile(read(JSON.stringify(file)).project));
  strictEqual(again.project.nodes.t1.futureNote, "hello");
  deepStrictEqual(again.project.nodes.t1.data.futureLayout, { a: 1 });
  strictEqual(again.project.nodes.g1.graphOptions.futureOption, true);
});

check("an older file without newer fields opens with defaults", () => {
  const old = {
    app: "helix",
    schemaVersion: 1,
    project: {
      nodes: {
        t1: { id: "t1", type: "table", name: "T", parentId: null, tableType: "grouped", data: { columns: ["X", "A:Y1"], rows: [[1, 2]], groups: 1, replicates: 1, xColumn: true } },
        g1: { id: "g1", type: "graph", name: "G", parentId: "t1", graphType: "grouped-bars", graphOptions: { center: "median" } },
      },
      rootOrder: ["t1"],
    },
  };
  const { project } = read(JSON.stringify(old));
  deepStrictEqual(project.childOrder, { t1: ["g1"] });
  strictEqual(project.nodes.g1.graphOptions!.center, "median");
  strictEqual(project.nodes.g1.graphOptions!.width, DEFAULT_GRAPH_OPTIONS.width);
  deepStrictEqual(project.nodes.t1.data!.rows, [["1", "2"]]); // numbers become cell text
});

check("wrong values fall back to their defaults", () => {
  const file = JSON.parse(serializeProjectFile(payload));
  Object.assign(file.project.nodes.g1.graphOptions, { width: "big", fontSize: null, bars: "yes", yMax: "ten" });
  file.project.nodes.g1.graphOptions.series = { Y1: { color: "red", shape: "star" }, Y2: { Color: "#00ff00", Shape: "Square", Pattern: "Dots", dash: "wavy", glow: 2 } };
  file.project.nodes.g1.graphOptions.points = {
    "Y1#0": { color: "pink", size: -2, Shape: "Square", future: 1 },
    "Y1#1": { color: "#ffffff", outline: "thick" },
    "not a point": { color: "#000000" },
  };
  const { project } = read(JSON.stringify(file));
  const o = project.nodes.g1.graphOptions!;
  strictEqual(o.width, DEFAULT_GRAPH_OPTIONS.width);
  strictEqual(o.fontSize, DEFAULT_GRAPH_OPTIONS.fontSize);
  strictEqual(o.bars, DEFAULT_GRAPH_OPTIONS.bars);
  strictEqual(o.yMax, undefined);
  // A style keeps what's unknown of it (glow), not a wrong dash.
  deepStrictEqual(o.series, { Y2: { color: "#00ff00", shape: "square", pattern: "dots", glow: 2 } });
  deepStrictEqual(o.points, { "Y1#0": { shape: "square", future: 1 }, "Y1#1": { color: "#ffffff" } });
});

check("a file from Helix 1.0 keeps its colors, now each graph's own", () => {
  const old = {
    app: "helix",
    project: {
      nodes: {
        t1: { id: "t1", type: "table", name: "T", parentId: null, tableType: "xy", data: { columns: ["Title", "X", "Y1", "Y2"], rows: [], seriesColors: { Y2: "Red" } } },
        g1: { id: "g1", type: "graph", name: "Plot", parentId: "t1", graphType: "xy-scatter", graphOptions: {} },
        g2: { id: "g2", type: "graph", name: "Heat", parentId: "t1", graphType: "heatmap", graphOptions: { heatmapColorScale: "yellow-red" } },
        g3: { id: "g3", type: "graph", name: "Heat 2", parentId: "t1", graphType: "heatmap", graphOptions: {} },
        g4: { id: "g4", type: "graph", name: "Volcano", parentId: "t1", graphType: "volcano", graphOptions: { volcanoColorUp: "green", volcanoPointSize: 8 } },
        g5: { id: "g5", type: "graph", name: "Box", parentId: "t1", graphType: "box-violin", graphOptions: { showPoints: true } },
        g6: { id: "g6", type: "graph", name: "Pie", parentId: "t1", graphType: "pie", graphOptions: {} },
      },
    },
  };
  const { project } = read(JSON.stringify(old));
  const { g1, g2, g3, g4, g5, g6 } = project.nodes;
  // The series drew in Helix 1.0's blue, then its red (the table's choice), fills at 50 %.
  const paint = paintOf(g1.graphOptions!, 2);
  strictEqual(paint.color("Y1", 0), NAMED_COLORS.blue);
  strictEqual(paint.fill("Y2", 1), "rgba(248,113,113,0.5)");
  strictEqual(paint.dot("Y2", 1), "rgba(248,113,113,0.5)");
  strictEqual(g1.graphOptions!.palette!.name, "helix");
  // A heatmap keeps its scale as Plotly drew it, or Viridis.
  strictEqual(g2.graphOptions!.palette!.name, "Heat (Helix 1.0)");
  strictEqual(g2.graphOptions!.palette!.colors.length, 256);
  deepStrictEqual([g2.graphOptions!.palette!.colors[0], g2.graphOptions!.palette!.colors[255]], ["#800026", "#FFFFCC"]);
  strictEqual(g3.graphOptions!.palette!.name, "viridis");
  // A volcano keeps its two colors.
  deepStrictEqual(g4.graphOptions!.series, { down: { color: NAMED_COLORS.blue }, up: { color: NAMED_COLORS.green } });
  // Points keep their size and outline: a box's 5 px, a volcano's own size and no outline.
  deepStrictEqual([g1.graphOptions!.pointSize, g1.graphOptions!.pointOutline], [7, 1.5]);
  deepStrictEqual([g4.graphOptions!.pointSize, g4.graphOptions!.pointOutline, g4.graphOptions!.pointFill], [8, 0, 0.75]);
  deepStrictEqual([g5.graphOptions!.pointSize, g5.graphOptions!.pointOutline], [5, 1.5]);
  // Shapes keep their outline (a box's 2 px), and a row's bars stay side by side.
  deepStrictEqual([g5.graphOptions!.outline, g1.graphOptions!.barGap], [2, 0]);
  strictEqual(g6.graphOptions!.fill, 1); // slices were solid
  // The old fields are gone once read.
  const again = JSON.parse(serializeProjectFile(project));
  ok(!("seriesColors" in again.project.nodes.t1.data));
  ok(!("heatmapColorScale" in again.project.nodes.g2.graphOptions));
  ok(!("volcanoColorUp" in again.project.nodes.g4.graphOptions));
  ok(!("volcanoPointSize" in again.project.nodes.g4.graphOptions));
});

check("bars and points have their own fill; new bars under points start half-opaque", () => {
  const fills = (options: GraphOptions) => {
    const [bar, , , points] = GRAPHS.individual.build(readTable(table.data!).numeric, options, paintOf(options, 2)).data as {
      marker: { color: string | string[] };
    }[];
    return [(bar.marker.color as string).match(/,([\d.]+)\)$/)![1], (points.marker.color as string[])[0].match(/,([\d.]+)\)$/)![1]];
  };
  const fresh = { ...newGraphOptions("individual"), bars: true };
  deepStrictEqual(fills(fresh), ["0.5", "1"]);
  deepStrictEqual(fills({ ...fresh, fill: 0.2, pointFill: 0.7 }), ["0.2", "0.7"]);
  strictEqual(newGraphOptions("grouped-bars").fill, 1);
});

check("outlines take the color of what they outline, or the one chosen", () => {
  const data = { columns: ["Title", "A", "B"], rows: [[null, "1", "2"], [null, "3", "4"]] };
  // Each column's bar, then its points: the traces with an outline.
  const outlines = (options: GraphOptions) =>
    (GRAPHS.individual.build(readTable(data).numeric, options, paintOf(options, 2)).data as { marker?: { line?: { color: unknown; width: unknown } } }[])
      .flatMap((t) => (t.marker?.line ? [t.marker.line] : []));
  const fresh: GraphOptions = {
    ...newGraphOptions("individual"),
    bars: true,
    series: { A: { color: "#CC79A7" } }, // not Okabe-Ito's first color, black
    points: { "A#1": { outlineColor: SAME_AS_FILL }, "B#0": { outlineColor: "#808080" } },
  };
  const [barA, pointsA, barB, pointsB] = outlines(fresh);
  const color = paintOf(fresh, 2).color;
  deepStrictEqual([barA, barB].map((l) => [l.color, l.width]), [[color("A", 0), 1.5], [color("B", 1), 1.5]]);
  deepStrictEqual([pointsA.color, pointsB.color], [[color("A", 0), color("A", 0)], ["#808080", color("B", 1)]]);
  const black = outlines({ ...fresh, outline: 3, outlineColor: "#000000", pointOutlineColor: "#000000" });
  deepStrictEqual([black[0].color, black[0].width], ["#000000", 3]);
  deepStrictEqual(black[1].color, ["#000000", "#CC79A7"]); // a point's own choice wins
  strictEqual(newGraphOptions("pie").outlineColor, "#FFFFFF"); // slices apart in white
  // A color given to an outline of none (a volcano's) comes with a thickness, so it shows.
  deepStrictEqual([visibleOutline(0, "#000000"), visibleOutline(0, SAME_AS_FILL), visibleOutline(2, "#000000")], [1.5, undefined, undefined]);
  // A row's bars stand apart on a new graph, so their outlines never overlap.
  const bars = GRAPHS["grouped-bars"].build(readTable(grouped()).columns, newGraphOptions("grouped-bars"), paintOf(fresh, 2));
  strictEqual(bars.layout.bargroupgap, 0.1);
  const xyData = { columns: ["Title", "X", "Y1", "Y2"], rows: [[null, "1", "2", "3"]] };
  strictEqual(GRAPHS["xy-bar"].build(readTable(xyData).columns, newGraphOptions("xy-bar"), paintOf(fresh, 2)).layout.bargroupgap, 0.1);
  // A series' own marker (a mean drawn as a point) takes the points' outline color too.
  const means = { ...newGraphOptions("mean-error"), shape: "point" as const, pointOutlineColor: "#808080" };
  const meanTraces = GRAPHS["mean-error"].build(readTable(data).numeric, means, paintOf(means, 2)).data as { marker?: { line?: { color: string } } }[];
  ok(meanTraces.some((t) => t.marker?.line?.color === "#808080"));
  // Selected, a point shows its own color, not its half-opaque fill nor its outline.
  const half = { ...fresh, pointFill: 0.5, pointOutlineColor: "#000000" };
  strictEqual(drawnStyle(GRAPHS.individual.build(readTable(data).numeric, half, paintOf(half, 2)).data, "A#0")!.color, color("A", 0));
});

check("error bars, the center line drawn with them, and lines take their own style", () => {
  const data = { columns: ["Title", "A", "B"], rows: [[null, "1", "2"], [null, "3", "5"]] };
  const options: GraphOptions = {
    ...newGraphOptions("individual"),
    series: { A: { color: "#CC79A7" } },
    errorWidth: 3,
    errorCaps: 0,
    errorDirection: "above",
  };
  type Trace = { mode?: string; line?: { color: string; width: number }; error_y?: Record<string, unknown> };
  const traces = GRAPHS.individual.build(readTable(data).numeric, options, paintOf(options, 2)).data as Trace[];
  const [center, whiskers] = traces.filter((t) => t.mode === "lines" || t.error_y);
  deepStrictEqual(center.line, { color: "#CC79A7", width: 3 });
  deepStrictEqual(whiskers.error_y, { type: "data", array: [1], symmetric: false, arrayminus: [0], color: "#CC79A7", thickness: 3, width: 0 });
  // A color chosen for them all, and every series line's thickness.
  const black = { ...options, errorColor: "#000000", lineWidth: 4 };
  const blackTraces = GRAPHS.individual.build(readTable(data).numeric, black, paintOf(black, 2)).data as Trace[];
  ok(blackTraces.filter((t) => t.mode === "lines" || t.error_y).every((t) => (t.line?.color ?? t.error_y!.color) === "#000000"));
  const groupedData = { columns: ["Title", "A:Y1", "B:Y1"], rows: [[null, "1", "2"], [null, "3", "4"]] };
  const lines = GRAPHS["grouped-lines"].build(readTable(groupedData).columns, black, paintOf(black, 2)).data as Trace[];
  deepStrictEqual(lines.map((t) => t.line!.width), [4, 4]);
});

check("series take their own dashes and patterns, and a palette can be reversed", () => {
  type Trace = { line?: { dash: string }; marker?: { color: string; pattern?: Record<string, unknown> }; fillpattern?: { shape: string } };
  const grouped = { columns: ["Title", "A:Y1", "B:Y1"], rows: [[null, "1", "2"], [null, "3", "4"]] };
  const options: GraphOptions = {
    ...newGraphOptions("grouped-lines"),
    lineDash: "dot",
    series: { B: { dash: "dash" }, A: { pattern: "diagonal" } },
  };
  const paint = paintOf(options, 2);
  const lines = GRAPHS["grouped-lines"].build(readTable(grouped).columns, options, paint).data as Trace[];
  deepStrictEqual(lines.map((t) => t.line!.dash), ["dot", "dash"]);
  const [a, b] = GRAPHS["grouped-bars"].build(readTable(grouped).columns, options, paint).data as Trace[];
  // Its lines in its color, over a light tint of it, so they show even on a solid fill.
  deepStrictEqual(a.marker!.pattern, {
    shape: "/",
    fgcolor: paint.color("A", 0),
    bgcolor: withOpacity(paint.color("A", 0), 0.4),
    fillmode: "replace",
    size: 8,
    solidity: 0.3,
  });
  ok(!("pattern" in b.marker!));
  const xy = { columns: ["Title", "X", "A"], rows: [[null, "1", "2"], [null, "2", "3"]] };
  const [area] = GRAPHS["xy-area"].build(readTable(xy).columns, options, paint).data as Trace[];
  strictEqual(area.fillpattern!.shape, "/");
  const column = { columns: ["Title", "A", "B"], rows: [[null, "1", "2"]] };
  const [slices] = GRAPHS.pie.build(readTable(column).numeric, options, paint).data as { marker: { pattern: { shape: string[] } } }[];
  deepStrictEqual(slices.marker.pattern.shape, ["/", ""]);
  // A new or reversed palette drops only the colors picked by hand.
  deepStrictEqual(withoutColors({ A: { color: "#000000" }, B: { color: "#FFFFFF", dash: "dot" } }), { B: { dash: "dot" } });
  const okabe = paletteOf(options);
  const reversed = reversedPalette(okabe);
  deepStrictEqual([reversed.colors[0], reversed.reversed], [okabe.colors.at(-1), true]);
  deepStrictEqual(reversedPalette(reversed), okabe);
  const file = JSON.parse(serializeProjectFile(payload));
  file.project.nodes.g1.graphOptions.palette = reversed;
  deepStrictEqual(read(JSON.stringify(file)).project.nodes.g1.graphOptions!.palette, reversed);
});

check("error bars that go one way have no foot: their caps are at their tips alone", () => {
  type Trace = { type: string; y: number[]; offsetgroup?: string; mode?: string; error_y?: { array: number[]; width: number } };
  const grouped = { columns: ["Title", "A:Y1", "A:Y2", "B:Y1", "B:Y2"], rows: [[null, "1", "3", "2", "6"]] };
  const above: GraphOptions = { ...newGraphOptions("grouped-bars"), errorDirection: "above", errorCaps: 8 };
  const built = GRAPHS["grouped-bars"].build(readTable(grouped).columns, above, paintOf(above, 2)).data;
  const [barA, capA, barB] = withCaps(built, above) as Trace[];
  strictEqual(barA.error_y!.width, 0); // the stem alone
  deepStrictEqual([capA.type, capA.offsetgroup, barA.offsetgroup, capA.y, capA.error_y!.array, capA.error_y!.width], ["bar", "0", "0", [3], [0], 8]);
  strictEqual(barB.offsetgroup, "1");
  // Points' error bars get a twin of points; error bars both ways keep their caps.
  const points = { ...newGraphOptions("grouped-lines"), errorDirection: "above" as const };
  const [, twin] = withCaps(GRAPHS["grouped-lines"].build(readTable(grouped).columns, points, paintOf(points, 2)).data, points) as Trace[];
  strictEqual(twin.mode, "markers");
  const both = newGraphOptions("grouped-bars");
  const plain = GRAPHS["grouped-bars"].build(readTable(grouped).columns, both, paintOf(both, 2)).data;
  deepStrictEqual(withCaps(plain, both), plain);
  strictEqual((plain[0] as Trace).error_y!.width, 6);
});

check("a series' shape wins over the graph's, on every point it draws", () => {
  const options: GraphOptions = { ...newGraphOptions("individual"), pointShape: "diamond", series: { B: { shape: "square" } } };
  const paint = paintOf(options, 2);
  const data = { columns: ["Title", "A", "B"], rows: [[null, "1", "2"], [null, "3", "4"]] };
  const traces = GRAPHS.individual.build(readTable(data).numeric, options, paint).data as { marker?: { symbol?: string[] } }[];
  deepStrictEqual(traces.map((t) => t.marker?.symbol?.[0]).filter(Boolean), ["diamond", "square"]);
});

check("a box's points are drawn over it, each with its own color", () => {
  const options: GraphOptions = { ...newGraphOptions("box-violin"), showPoints: true };
  const data = { columns: ["Title", "A"], rows: [[null, "1"], [null, "3"]] };
  options.points = { "A#0": { color: NAMED_COLORS.green } };
  const [box, points] = GRAPHS["box-violin"].build(readTable(data).numeric, options, paintOf(options, 1)).data as {
    type: string;
    boxpoints?: boolean;
    marker?: { line: { color: string[] } };
  }[];
  deepStrictEqual([box.type, box.boxpoints, points.type], ["box", false, "scatter"]);
  strictEqual(points.marker!.line.color[0], NAMED_COLORS.green);
});

check("the selection ring circles exactly the selected points, and is never exported", () => {
  const options = newGraphOptions("individual");
  const data = { columns: ["Title", "A"], rows: [[null, "1"], [null, "3"], [null, "5"]] };
  const fig = GRAPHS.individual.build(readTable(data).numeric, options, paintOf(options, 1)).data;
  strictEqual(selectionRing(fig, new Set(), "#FF0000"), null);
  const ring = selectionRing(fig, new Set(["A#2", "B#0"]), "#FF0000")!; // B#0 isn't drawn
  const points = fig.find((t) => (t as { customdata?: unknown }).customdata) as { x: number[]; y: number[] };
  deepStrictEqual([ring.x, ring.y], [[points.x[2]], [5]]);
  deepStrictEqual(withoutSelection([...fig, ring]), fig);
  deepStrictEqual([...drawnKeys(fig)], ["A#0", "A#1", "A#2"]);
});

check("a drag picks the points it covers, alone or added to the selection", () => {
  const reported = [{ customdata: "A#1" }, { customdata: undefined }, { customdata: "B#0" }]; // a bar has no key
  deepStrictEqual(keysOf(reported), ["A#1", "B#0"]);
  deepStrictEqual([...picked(new Set(["A#0"]), ["A#1"], false)], ["A#1"]);
  deepStrictEqual([...picked(new Set(["A#0", "A#1"]), ["A#1", "B#0"], true)], ["A#0", "A#1", "B#0"]);
});

check("styling selected points touches only them; Reset and unset fields leave no trace", () => {
  const points = { "A#0": { size: 9 }, "A#1": { color: "#000000" } };
  deepStrictEqual(stylePoints(points, ["A#1", "A#2"], { label: true }), {
    "A#0": { size: 9 },
    "A#1": { color: "#000000", label: true },
    "A#2": { label: true },
  });
  deepStrictEqual(stylePoints(points, ["A#1"], null), { "A#0": { size: 9 } });
  deepStrictEqual(stylePoints({ "A#0": { label: true } }, ["A#0"], { label: undefined }), undefined);
});

check("Bigger and Smaller change each point from its own size, within the sizes allowed", () => {
  const points = { "A#1": { size: 11, color: "#000000" }, "A#2": { size: 20 } };
  const options: GraphOptions = { ...newGraphOptions("individual"), points };
  const data = { columns: ["Title", "A"], rows: [[null, "1"], [null, "3"], [null, "5"]] };
  const fig = GRAPHS.individual.build(readTable(data).numeric, options, paintOf(options, 1)).data;
  deepStrictEqual(resizePoints(points, fig, ["A#0", "A#1", "A#2", "B#0"], 1), {
    "A#0": { size: 8 },
    "A#1": { size: 12, color: "#000000" },
    "A#2": { size: 20 },
  });
  deepStrictEqual(resizePoints(undefined, fig, ["A#0"], -6), { "A#0": { size: 2 } });
});

check("a point shows its row's title as its name, else its row number", () => {
  const options: GraphOptions = { ...newGraphOptions("individual"), points: { "A#0": { label: true }, "A#1": { label: true } } };
  const data = { columns: ["Title", "A"], rows: [["Mouse 1", "1"], [null, "3"]] };
  const fig = GRAPHS.individual.build(readTable(data).numeric, options, paintOf(options, 1)).data;
  deepStrictEqual(pointLabels(fig, options.points, ["Mouse 1", null], 13).map((l) => l.text), ["Mouse 1", "Row 2"]);
  const file = JSON.parse(serializeProjectFile(payload));
  file.project.nodes.g1.graphOptions.points = { "Y1#0": { label: true }, "Y1#1": { label: "yes" } };
  deepStrictEqual(read(JSON.stringify(file)).project.nodes.g1.graphOptions!.points, { "Y1#0": { label: true } });
  // Outline colors: a hex, or a point's "fill"; anything else is left out.
  Object.assign(file.project.nodes.g1.graphOptions, { outlineColor: "black", pointOutlineColor: "#00FF00", errorColor: "red" });
  file.project.nodes.g1.graphOptions.points = { "Y1#0": { outlineColor: "FILL" }, "Y1#1": { outlineColor: "red" } };
  const o = read(JSON.stringify(file)).project.nodes.g1.graphOptions!;
  deepStrictEqual([o.outlineColor, o.pointOutlineColor, o.errorColor, o.points], [undefined, "#00FF00", undefined, { "Y1#0": { outlineColor: SAME_AS_FILL } }]);
});

// A volcano's genes, one per row; the first has no P value, so it isn't drawn.
const genes = { columns: ["Title", "Gene", "LFC", "P"], rows: [[null, "A1", "2", ""], [null, "B2", "0.1", "0.5"], [null, "C3", "-3", "0.001"]] };
const volcanoOptions: GraphOptions = { ...newGraphOptions("volcano"), volcanoX: "LFC", volcanoY: "P", volcanoLabel: "Gene", volcanoYIsPValue: true };

check("a volcano gene is its row: its own style wins over up / down, and it can show its name", () => {
  const options: GraphOptions = { ...volcanoOptions, volcanoLabelCount: 0, points: { "#1": { color: "#000000", shape: "diamond", label: true } } };
  const fig = GRAPHS.volcano.build(readTable(genes).columns, options, paintOf(options, 2));
  // The styled gene is drawn over the others.
  const traces = fig.data as { customdata: string[]; marker: { color: string[] } }[];
  deepStrictEqual(traces.map((t) => t.customdata), [["#2"], ["#1"]]);
  strictEqual(traces[1].marker.color[0], "rgba(0,0,0,0.75)"); // filled as the graph's points are
  deepStrictEqual(drawnStyle(fig.data, "#1"), { color: "#000000", size: 5, shape: "diamond", fill: 0.75, outline: 0 });
  deepStrictEqual((fig.layout.annotations as { text: string }[]).map((a) => a.text), ["B2"]);
});

check("genes are found by their whole name, in any case, several at once", () => {
  const columns = readTable(genes).columns;
  deepStrictEqual(genesNamed(columns, volcanoOptions, " C3, b2 ,Nope"), { keys: ["#2", "#1"], missing: ["Nope"] });
  deepStrictEqual(genesNamed(columns, volcanoOptions, "b"), { keys: [], missing: ["b"] });
});

check("a grouped volcano's genes keep their table rows, and follow them", () => {
  const data = { columns: ["Title", "A:Y1", "A:Y2", "B:Y1", "B:Y2"], rows: [["g1", "1", "", "2", "3"], ["g2", "1", "2", "3", "4"], ["g3", "2", "3", "5", "6"]] };
  deepStrictEqual(computeGroupedDEG(data, "A", "B", "log2ratio").map((d) => [d.row, d.label]), [[1, "g2"], [2, "g3"]]);
  const v = { ...graph, graphOptions: { ...graph.graphOptions!, points: { "#2": { size: 9 } } } };
  deepStrictEqual(followTable(v, { rows: rowsInserted(0, 1) }, data.columns).graphOptions!.points, { "#3": { size: 9 } });
});

check("texts moved by hand stay where they were dropped", () => {
  // What Plotly reports of a move: the legend, a color legend, a named text; a
  // significance label has no name, so it isn't one.
  deepStrictEqual(movedText({ "legend.x": 0.8, "legend.y": 0.1 }, []), { name: "legend", at: { x: 0.8, y: 0.1 } });
  deepStrictEqual(movedText({ "colorbar.x": 0.7, "colorbar.y": 0.3 }, []), { name: "legend", at: { x: 0.7, y: 0.3 } });
  deepStrictEqual(movedText({ "annotations[1].ax": 40, "annotations[1].ay": -20 }, ["note", "A#1"]), { name: "A#1", at: { x: 40, y: -20 } });
  strictEqual(movedText({ "annotations[0].ax": 5, "annotations[0].ay": 5 }, [undefined]), null);
  // Drawn there: the legend, a heatmap's color legend, the note, a point's or a gene's name.
  const xy = { columns: ["Title", "X", "Y1", "Y2"], rows: [[null, "1", "2", "3"]] };
  const moved: GraphOptions = { ...newGraphOptions("xy-scatter"), legend: { x: 0.5, y: 0.2 }, note: { x: 30, y: 40 } };
  deepStrictEqual(GRAPHS["xy-scatter"].build(readTable(xy).columns, moved, paintOf(moved, 2)).layout.legend, { x: 0.5, y: 0.2, xanchor: "left" });
  const heat = GRAPHS.heatmap.build(readTable(xy).numeric, moved, paintOf(moved, 0)).data[0] as { colorbar?: object };
  deepStrictEqual(heat.colorbar, { x: 0.5, y: 0.2 });
  const fig: GraphFigure = { data: [], layout: {} };
  addNote(fig, "Y = X", moved);
  const [note] = fig.layout.annotations as { name: string; ax: number; ay: number }[];
  deepStrictEqual([note.name, note.ax, note.ay], ["note", 30, 40]);
  const labelled: GraphOptions = { ...newGraphOptions("individual"), points: { "A#0": { label: true, labelOffset: { x: -25, y: 15 } }, "A#1": { label: true } } };
  const data = { columns: ["Title", "A"], rows: [["Mouse 1", "1"], [null, "3"]] };
  const names = pointLabels(GRAPHS.individual.build(readTable(data).numeric, labelled, paintOf(labelled, 1)).data, labelled.points, ["Mouse 1"], 13);
  deepStrictEqual(names.map((n) => [n.name, n.ax, n.ay]), [["A#0", -25, 15], ["A#1", names[1].ax, 0]]);
  ok(names[1].ax > 0); // right of its point
  const gene = { ...volcanoOptions, volcanoLabelCount: 5, points: { "#2": { labelOffset: { x: -30, y: 10 } } } };
  const geneNames = GRAPHS.volcano.build(readTable(genes).columns, gene, paintOf(gene, 2)).layout.annotations as { name: string; ax: number; ay: number }[];
  deepStrictEqual(geneNames.map((n) => [n.name, n.ax, n.ay]), [["#2", -30, 10]]);
  // Read back from a file; a place that isn't two numbers is left out.
  const file = JSON.parse(serializeProjectFile(payload));
  Object.assign(file.project.nodes.g1.graphOptions, { legend: { x: 0.9, y: 0.4 }, note: { x: "far" } });
  file.project.nodes.g1.graphOptions.points = { "Y1#0": { labelOffset: { x: 12, y: -8 } } };
  const o = read(JSON.stringify(file)).project.nodes.g1.graphOptions!;
  deepStrictEqual([o.legend, o.note, o.points], [{ x: 0.9, y: 0.4 }, undefined, { "Y1#0": { labelOffset: { x: 12, y: -8 } } }]);
});

check("palettes keep their authors' colors, in their order and number", () => {
  const counts = Object.fromEntries(PALETTES.map((p) => [p.name, p.colors.length]));
  deepStrictEqual(counts, {
    "okabe-ito": 8, "tol-bright": 7, "tol-muted": 9, "tableau-10": 10, grayscale: 5, helix: 6,
    viridis: 256, cividis: 256, magma: 256, batlow: 256,
    coolwarm: 256, fast: 256, vik: 256, vlag: 256, rdbu: 11,
  });
  ok(PALETTES.every((p) => p.colors.every((c) => /^#[0-9A-F]{6}$/.test(c))));
  deepStrictEqual(paletteNamed("okabe-ito")!.colors, ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"]);
});

check("a broken item is left out alone, and said so", () => {
  const file = JSON.parse(serializeProjectFile(payload));
  file.project.nodes.bad = { type: "graph" };
  file.project.nodes.orphan = { id: "orphan", type: "graph", name: "O", parentId: "missing", graphType: "pie" };
  file.project.nodes.t2 = { id: "t2", type: "table", name: "Future", parentId: null, tableType: "nested", data: { columns: ["Title", "A"], rows: [] } };
  const { project, issues } = read(JSON.stringify(file));
  deepStrictEqual(Object.keys(project.nodes).sort(), ["a1", "g1", "t1", "t2"]);
  strictEqual(project.nodes.t2.tableType, "column");
  deepStrictEqual(project.rootOrder, ["t1", "t2"]);
  ok(issues.some((i) => i.message.includes("2 unreadable items")));
  ok(issues.some((i) => i.message.includes("Future")));
});

// ── Table edits ──────────────────────────────────────────────────────────

const grouped = (): TableData => {
  let t = newGroupedTable(2, 3); // A:Y1 A:Y2 A:Y3 B:Y1 B:Y2 B:Y3
  t = writeBlock(t, 0, 0, [["r1", "a1", "a2", "a3", "b1", "b2", "b3"]], "grouped");
  t = renameGroup(t, "B", "Treated");
  return { ...t, excluded: ["0,4"] }; // Treated:Y1
};

check("fewer sub-columns keep each value in its group", () => {
  const t = regroupTable(grouped(), 2, 2);
  deepStrictEqual(t.columns, ["Title", "A:Y1", "A:Y2", "Treated:Y1", "Treated:Y2"]);
  deepStrictEqual(t.rows[0], ["r1", "a1", "a2", "b1", "b2"]);
  deepStrictEqual(t.excluded, ["0,3"]);
});

check("more groups and sub-columns add empty ones after the data", () => {
  const t = regroupTable(grouped(), 3, 4);
  deepStrictEqual(t.columns.slice(1, 5), ["A:Y1", "A:Y2", "A:Y3", "A:Y4"]);
  deepStrictEqual(t.columns.slice(-4), ["C:Y1", "C:Y2", "C:Y3", "C:Y4"]);
  deepStrictEqual(t.rows[0].slice(5, 9), ["b1", "b2", "b3", null]);
});

check("an XY table with a renamed X gets Y columns, not a second X", () => {
  deepStrictEqual(freshColumnNames(["Title", "Dose", "Y1"], "xy", 2), ["Y2", "Y3"]);
  deepStrictEqual(freshColumnNames(["Title"], "xy", 2), ["X", "Y1"]);
});

// ── Renamed columns ──────────────────────────────────────────────────────

check("analyses follow renamed columns", () => {
  const regression = followTable(analysis, { renamed: { Y1: "Response" } }, []);
  deepStrictEqual(regression.analysisParams, { y: "Response", forceOrigin: true });
  const multiple = followTable(
    { ...analysis, analysisType: "multiple-regression", analysisParams: { dependent: "Y1", predictors: ["Age", "BMI"] } },
    { renamed: { BMI: "Body mass" } },
    [],
  );
  deepStrictEqual(multiple.analysisParams, { dependent: "Y1", predictors: ["Age", "Body mass"] });
});

check("graphs follow renamed columns, groups, compared pairs and colors", () => {
  const node: ProjectNode = {
    ...graph,
    graphOptions: {
      ...DEFAULT_GRAPH_OPTIONS,
      doseY: "Y1",
      volcanoGroupA: "A",
      sigPairs: [pairKey("Y1", "Y2"), pairKey("Y2", "Y3")],
      title: "Y1",
      series: { Y1: { color: "#D55E00" }, Y2: { color: "#0072B2" } },
    },
  };
  const o = followTable(node, { renamed: { Y1: "Drug", A: "Control" } }, ["Title", "Drug", "Y2", "Y3"]).graphOptions!;
  strictEqual(o.doseY, "Drug");
  strictEqual(o.volcanoGroupA, "Control");
  deepStrictEqual(o.sigPairs, [pairKey("Drug", "Y2"), pairKey("Y2", "Y3")]);
  deepStrictEqual(o.series, { Drug: { color: "#D55E00" }, Y2: { color: "#0072B2" } });
  strictEqual(o.title, "Y1"); // the user's text is left alone
});

check("styled points follow moved rows, renamed columns and groups, and leave with their column", () => {
  const styled = (points: Record<string, { size: number }>, columns: string[], move: Parameters<typeof followTable>[1]) =>
    followTable({ ...graph, graphOptions: { ...graph.graphOptions!, points } }, move, columns).graphOptions!.points;
  const points = { "Y1#0": { size: 1 }, "Y1#3": { size: 2 } };
  deepStrictEqual(styled(points, ["Title", "Y1"], { rows: rowsInserted(1, 2) }), { "Y1#0": { size: 1 }, "Y1#5": { size: 2 } });
  deepStrictEqual(styled(points, ["Title", "Y1"], { rows: rowsDeleted(0, 1) }), { "Y1#2": { size: 2 } });
  deepStrictEqual(styled(points, ["Title", "Dose"], { renamed: { Y1: "Dose" } }), { "Dose#0": { size: 1 }, "Dose#3": { size: 2 } });
  deepStrictEqual(styled({ "A:Y1#1": { size: 3 } }, ["Title", "Ctrl:Y1"], { renamed: { A: "Ctrl" } }), { "Ctrl:Y1#1": { size: 3 } });
  strictEqual(styled(points, ["Title", "Y2"], {}), undefined); // its column was deleted
});

check("deleting a column drops its points' styles, even with no move given", () => {
  let s = makeInitialState();
  const tableId = s.rootOrder[0];
  const data: TableData = { columns: ["Title", "A", "B"], rows: [[null, "1", "2"]] };
  s = reducer(s, { type: "updateTable", id: tableId, data, label: "Typing" });
  const g = { ...graph, id: "g9", parentId: tableId, graphOptions: { ...graph.graphOptions!, points: { "A#0": { size: 9 }, "B#0": { size: 9 } } } };
  s = reducer(s, { type: "create", node: g });
  s = reducer(s, { type: "updateTable", id: tableId, data: { columns: ["Title", "A"], rows: [[null, "1"]] }, label: "Delete Column" });
  deepStrictEqual(s.nodes.g9.graphOptions!.points, { "A#0": { size: 9 } });
});

check("cell colors from older files become their graphs' point colors", () => {
  const file = JSON.parse(serializeProjectFile(payload));
  file.project.nodes.t1.data.pointColors = { "Y1#1": "Green" };
  const { project } = read(JSON.stringify(file));
  // The graph's own style of a point wins; the cell's color joins the rest.
  deepStrictEqual(project.nodes.g1.graphOptions!.points, {
    "Y1#1": { color: NAMED_COLORS.green },
    "Y1#0": { color: "#0072B2", size: 10 },
  });
  ok(!("pointColors" in JSON.parse(serializeProjectFile(project)).project.nodes.t1.data));
});

check("a point's own color, size, shape, fill and outline reach its marker", () => {
  const options: GraphOptions = {
    ...newGraphOptions("individual"),
    pointFill: 0.5,
    points: { "A#1": { color: "#000000", size: 12, shape: "triangle-up", fill: 0.3, outline: 3 } },
  };
  const data = { columns: ["Title", "A"], rows: [[null, "1"], [null, "3"]] };
  const traces = GRAPHS.individual.build(readTable(data).numeric, options, paintOf(options, 1)).data;
  const m = (traces as { marker?: { color: string[]; size: number[]; symbol: string[]; line: { color: string[]; width: number[] } } }[])
    .find((t) => Array.isArray(t.marker?.size))!.marker!;
  deepStrictEqual([m.size, m.symbol, m.line.width, m.line.color[1]], [[7, 12], ["circle", "triangle-up"], [1.5, 3], "#000000"]);
  deepStrictEqual([m.color[1], drawnStyle(traces, "A#0")!.fill, drawnStyle(traces, "A#1")!.fill], ["rgba(0,0,0,0.3)", 0.5, 0.3]);
  // In the file, a fill is kept from 0 to 1.
  const file = JSON.parse(serializeProjectFile(payload));
  file.project.nodes.g1.graphOptions.points = { "Y1#0": { fill: 0 }, "Y1#1": { fill: 1.5 } };
  deepStrictEqual(read(JSON.stringify(file)).project.nodes.g1.graphOptions!.points, { "Y1#0": { fill: 0 } });
});

check("an exported image says its resolution, and none of the headers that say 72 DPI", async () => {
  const chunk = (name: string, data: number[]) => [0, 0, 0, data.length, ...[...name].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = [...signature, ...chunk("IHDR", Array(13).fill(1)), ...chunk("eXIf", [7]), ...chunk("pHYs", Array(9).fill(2)), ...chunk("IDAT", [3]), ...chunk("IEND", [])];
  const out = new Uint8Array(await withDpi(new Uint8Array(png), "png", 300).arrayBuffer());
  const names: string[] = [];
  for (let at = 8; at < out.length; at += 12 + out[at + 3]) names.push(String.fromCharCode(...out.subarray(at + 4, at + 8)));
  deepStrictEqual(names, ["IHDR", "pHYs", "IDAT", "IEND"]);
  const phys = new DataView(out.buffer, 33);
  deepStrictEqual([phys.getUint32(8), phys.getUint32(12), out[49], phys.getUint32(17)], [11811, 11811, 1, crc32(out.subarray(37, 50))]);
  // A JPEG: its JFIF header at 300 DPI, first; Exif and Photoshop's left out, a color profile kept.
  const segment = (marker: number, name: string) => [0xff, marker, 0, 6, ...[...name].map((c) => c.charCodeAt(0))];
  const jpeg = [0xff, 0xd8, ...segment(0xe0, "JFIF"), ...segment(0xe1, "Exif"), ...segment(0xe2, "ICC_"), ...segment(0xed, "Phot"), 0xff, 0xdb, 9];
  const jpg = [...new Uint8Array(await withDpi(new Uint8Array(jpeg), "jpeg", 300).arrayBuffer())];
  deepStrictEqual(jpg, [0xff, 0xd8, 0xff, 0xe0, 0, 16, ...segment(0, "JFIF").slice(4), 0, 1, 1, 1, 1, 44, 1, 44, 0, 0, ...segment(0xe2, "ICC_"), 0xff, 0xdb, 9]);
});

check("an analysis whose column is gone says so, and never uses another one", async () => {
  const data: TableData = { columns: ["Title", "X", "Y1", "Y2"], rows: [[null, "1", "2", "3"], [null, "2", "4", "5"]] };
  for (const [type, params] of [
    ["linear-regression", { y: "Gone", forceOrigin: false }],
    ["nonlinear-regression", { y: "Gone", model: "line" }],
    ["multiple-regression", { dependent: "Y1", predictors: ["Gone"] }],
    ["correlation", { method: "pearson", mode: "two-datasets", datasets: ["Y1", "Gone"] }],
  ] as const) {
    const outcome = await runAnalysis(type, data, params as AnalysisParams);
    ok("error" in outcome && outcome.error.includes("“Gone” is no longer in the table"), type);
  }
});

// ── Undo ─────────────────────────────────────────────────────────────────

check("Undo and Redo take back and replay every kind of change", () => {
  let s = makeInitialState();
  const tableId = s.rootOrder[0];
  const empty = s.nodes[tableId].data!;
  const filled: TableData = { ...empty, rows: [[null, "1", "2"]] };
  s = reducer(s, { type: "updateTable", id: tableId, data: filled, label: "Typing" });
  s = reducer(s, { type: "rename", id: tableId, name: "Doses" });
  deepStrictEqual(s.past.map((step) => step.label), ["Typing", "Rename"]); // "Undo Rename" in the Edit menu
  s = reducer(s, { type: "undo" });
  strictEqual(s.future.at(-1)?.label, "Rename"); // "Redo Rename"
  strictEqual(s.nodes[tableId].name, "Table 1");
  strictEqual(s.nodes[tableId].data, filled);
  s = reducer(s, { type: "undo" });
  strictEqual(s.nodes[tableId].data, empty);
  s = reducer(s, { type: "redo" });
  s = reducer(s, { type: "redo" });
  strictEqual(s.nodes[tableId].name, "Doses");
  strictEqual(s.future.length, 0);
});

check("a deleted table comes back with its analyses and graphs", () => {
  let s = makeInitialState();
  const tableId = s.rootOrder[0];
  s = reducer(s, { type: "create", node: { ...analysis, parentId: tableId } });
  s = reducer(s, { type: "remove", id: tableId });
  strictEqual(Object.keys(s.nodes).length, 0);
  s = reducer(s, { type: "undo" });
  deepStrictEqual(Object.keys(s.nodes).sort(), [analysis.id, tableId].sort());
  deepStrictEqual(s.childOrder[tableId], [analysis.id]);
});

check("quick edits to one graph undo together; a pause starts a new step", () => {
  let s = reducer(makeInitialState(), { type: "create", node: graph });
  const set = (title: string, at: number) =>
    (s = reducer(s, { type: "updateGraph", id: graph.id, options: { ...DEFAULT_GRAPH_OPTIONS, title }, at }));
  set("T", 1000);
  set("Ti", 1200);
  set("Title", 1400);
  set("Title 2", 5000);
  s = reducer(s, { type: "undo" });
  strictEqual(s.nodes[graph.id].graphOptions!.title, "Title");
  s = reducer(s, { type: "undo" });
  strictEqual(s.nodes[graph.id].graphOptions, graph.graphOptions);
});

check("changes that change nothing, and opening a file, leave no Undo step", () => {
  let s = makeInitialState();
  s = reducer(s, { type: "reorderRoot", order: [...s.rootOrder] });
  strictEqual(s.past.length, 0);
  s = reducer(s, { type: "rename", id: s.rootOrder[0], name: "Table 1" });
  strictEqual(s.past.length, 0);
  s = reducer(s, { type: "rename", id: s.rootOrder[0], name: "Other" });
  s = reducer(s, { type: "load", nodes: {}, rootOrder: [], childOrder: {}, activeNodeId: null, filePath: "/x.hlx" });
  strictEqual(s.past.length, 0);
});

check("a file is never trusted: unknown types, R code in params, a huge graph", async () => {
  const file = JSON.parse(serializeProjectFile(payload));
  const nodes = file.project.nodes;
  nodes.t1.tableType = "constructor";
  nodes.a1 = { type: "analysis", name: "A", parentId: "t1", analysisType: "constructor" };
  nodes.a2 = {
    type: "analysis", name: "B", parentId: "t1", analysisType: "one-sample-t",
    analysisParams: { hypotheticalValue: "0);quit(", tails: "LESS", gaussian: true, y: "Dose (µM)" },
  };
  Object.assign(nodes.g1.graphOptions, { width: 1e9, height: -5 });
  const { project, issues } = read(JSON.stringify(file));
  strictEqual(project.nodes.t1.tableType, "column");
  strictEqual(issues.filter((i) => /doesn't know/.test(i.message)).length, 2);
  deepStrictEqual(project.nodes.a2.analysisParams, { tails: "less", gaussian: true, y: "Dose (µM)" });
  const o = project.nodes.g1.graphOptions!;
  deepStrictEqual([o.width, o.height], [2400, 120]);
  ok("error" in (await runAnalysis("constructor" as never, project.nodes.t1.data!)));
});

check("too large a number to be one is text", () => {
  deepStrictEqual(readTable({ columns: ["Title", "A"], rows: [[null, "1e999"], [null, "1e300"]] }).columns[0].values, [1e300]);
});

check("a Mean & error line takes the graph's dashes", () => {
  const options: GraphOptions = { ...newGraphOptions("mean-error"), shape: "line", lineDash: "dot" };
  const data = { columns: ["Title", "A", "B"], rows: [[null, "1", "2"], [null, "3", "4"]] };
  const [line] = GRAPHS["mean-error"].build(readTable(data).numeric, options, paintOf(options, 2)).data as { line: { dash: string } }[];
  strictEqual(line.line.dash, "dot");
});

check("a survival curve runs on to the last subject followed", () => {
  const options = newGraphOptions("survival");
  // Deaths at 1 and 2, then one subject censored at 5.
  const data = { columns: ["Title", "X", "A"], rows: [[null, "1", "1"], [null, "2", "1"], [null, "5", "0"]] };
  const [curve] = GRAPHS.survival.build(readTable(data).columns, options, paintOf(options, 1)).data as { x: number[]; y: number[] }[];
  // The last step, at the level of the last death.
  deepStrictEqual([curve.x.slice(-2), curve.y.at(-1)], [[2, 5], curve.y.at(-2)]);
});

check("a huge volcano names its genes, and thousands of genes resize at once", () => {
  const volcanoOf = (n: number) => {
    const columns = readTable({
      columns: ["Title", "Gene", "LFC", "P"],
      rows: Array.from({ length: n }, (_, r) => [null, r < 3 ? `G${r}` : null, String((r % 200) / 50 - 2), String(((r % 997) + 1) / 1000)]),
    }).columns;
    const options: GraphOptions = { ...volcanoOptions, volcanoLabelCount: 3 };
    return GRAPHS.volcano.build(columns, options, paintOf(options, 2));
  };
  strictEqual((volcanoOf(1_000_000).layout.annotations as unknown[]).length, 3);
  // 20,000 genes, all selected: milliseconds, never seconds, whatever the machine.
  const fig = volcanoOf(20_000);
  const keys = Array.from({ length: 20_000 }, (_, r) => `#${r}`);
  const start = performance.now();
  const sized = resizePoints(undefined, fig.data, keys, 1)!;
  ok(performance.now() - start < 1000, "resizing took over a second");
  strictEqual(Object.keys(sized).length, 20_000);
});

check("a release is newer only when its version number is higher", () => {
  ok(isNewer("v1.1.0", "1.0.0"));
  ok(isNewer("v1.10.0", "1.9.0"));
  ok(isNewer("2", "1.99.9"));
  ok(!isNewer("v1.0.0", "1.0.0"));
  ok(!isNewer("1.0", "1.0.1"));
});

// ── Run ──────────────────────────────────────────────────────────────────

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
  } catch (err) {
    failed++;
    console.log(`✗ ${name}\n  ${err instanceof Error ? err.message.split("\n").join("\n  ") : err}`);
  }
}
console.log(failed ? `${failed} of ${checks.length} checks failed.` : `All ${checks.length} checks pass.`);
process.exitCode = failed ? 1 : 0;
