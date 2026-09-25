/// <reference types="node" />
// Checks for what must never break: .hlx files opening across versions, table
// edits keeping every value where it belongs, and analyses and graphs following
// renamed columns. `npm test` runs them.
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { parseProjectFile, serializeProjectFile, type ProjectFilePayload } from "../src/lib/project-file";
import { DEFAULT_GRAPH_OPTIONS, type ProjectNode, type TableData } from "../src/store/types";
import { freshColumnNames, newGroupedTable, regroupTable, renameGroup, writeBlock } from "../src/views/tables/table-data";
import { renameReferences } from "../src/store/references";
import { pairKey } from "../src/views/graphs/significance-overlay";
import { runAnalysis } from "../src/stats";
import { makeInitialState, reducer } from "../src/store/use-project-store";
import { isNewer } from "../src/lib/version";
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
    seriesColors: { Y1: "red" },
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
  graphOptions: { ...DEFAULT_GRAPH_OPTIONS, title: "My Title", yMax: 10, regAnalysisId: "a1" },
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
  file.project.nodes.t1.data.seriesColors = { Y1: "pink", X: "Blue" };
  const { project } = read(JSON.stringify(file));
  const o = project.nodes.g1.graphOptions!;
  strictEqual(o.width, DEFAULT_GRAPH_OPTIONS.width);
  strictEqual(o.fontSize, DEFAULT_GRAPH_OPTIONS.fontSize);
  strictEqual(o.bars, DEFAULT_GRAPH_OPTIONS.bars);
  strictEqual(o.yMax, undefined);
  deepStrictEqual(project.nodes.t1.data!.seriesColors, { X: "blue" });
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
  const regression = renameReferences(analysis, { Y1: "Response" });
  deepStrictEqual(regression.analysisParams, { y: "Response", forceOrigin: true });
  const multiple = renameReferences(
    { ...analysis, analysisType: "multiple-regression", analysisParams: { dependent: "Y1", predictors: ["Age", "BMI"] } },
    { BMI: "Body mass" },
  );
  deepStrictEqual(multiple.analysisParams, { dependent: "Y1", predictors: ["Age", "Body mass"] });
});

check("graphs follow renamed columns, groups and compared pairs", () => {
  const node: ProjectNode = {
    ...graph,
    graphOptions: {
      ...DEFAULT_GRAPH_OPTIONS,
      doseY: "Y1",
      volcanoGroupA: "A",
      sigPairs: [pairKey("Y1", "Y2"), pairKey("Y2", "Y3")],
      title: "Y1",
    },
  };
  const o = renameReferences(node, { Y1: "Drug", A: "Control" }).graphOptions!;
  strictEqual(o.doseY, "Drug");
  strictEqual(o.volcanoGroupA, "Control");
  deepStrictEqual(o.sigPairs, [pairKey("Drug", "Y2"), pairKey("Y2", "Y3")]);
  strictEqual(o.title, "Y1"); // the user's text is left alone
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
  s = reducer(s, { type: "rename", id: s.rootOrder[0], name: "Other" });
  s = reducer(s, { type: "load", nodes: {}, rootOrder: [], childOrder: {}, activeNodeId: null, filePath: "/x.hlx" });
  strictEqual(s.past.length, 0);
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
