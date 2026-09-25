# The Helix project file (`.hlx`)

A Helix project is one plain-text JSON file (UTF-8). Any program can read or write
it: your data is never locked into Helix.

## Promises

- **Old files always open.** Fields are only ever added in new versions, never
  renamed or removed.
- **Newer files open too.** A version of Helix keeps the fields it doesn't know and
  writes them back when saving, so opening a newer file in an older Helix loses nothing.
- **Forgiving reading.** Field names and choices are read whatever their case
  (`tableType`, `TableType`, `"XY"`). A value of the wrong type falls back to its
  default. A broken item is left out on its own, and Helix says so.
- **Nothing about you.** The file holds the project only: no file paths, user
  names or app state.

## Layout

```json
{
  "app": "helix",
  "schemaVersion": 1,
  "savedAt": "2026-09-24T12:00:00.000Z",
  "project": {
    "nodes": { "<id>": { … }, … },
    "rootOrder": ["<table id>", …],
    "childOrder": { "<table id>": ["<analysis or graph id>", …] },
    "activeNodeId": "<id>"
  }
}
```

- `app` is always `"helix"`. `schemaVersion` and `savedAt` are informative.
- `nodes` holds every item, keyed by its `id`.
- `rootOrder` lists the data tables in sidebar order; `childOrder` the analyses and
  graphs of each table. Items missing from these lists are shown after the others.
- `activeNodeId` is the item shown when the file opens.

## Items

Every item has `id`, `type` (`"table"`, `"analysis"` or `"graph"`), `name`, and
`parentId`: `null` for a table, the table's id for an analysis or a graph.

### Data table

```json
{
  "id": "table_x1y2", "type": "table", "name": "Table 1", "parentId": null,
  "tableType": "grouped",
  "data": {
    "columns": ["Title", "A:Y1", "A:Y2", "B:Y1", "B:Y2"],
    "rows": [
      ["Day 1", "10", "11", "14", "15"],
      ["Day 2", "12", null, "18", "19"]
    ],
    "groups": 2,
    "replicates": 2
  }
}
```

- `tableType`: `"column"`, `"xy"`, `"grouped"`, `"multiple"` (Multiple Variables)
  or `"contingency"`.
- `columns`: the column names. The first is always the row-title column (`Title`);
  in an XY table the second is X.
- `rows`: one list per row, one cell per column, as typed: text, or `null` for an
  empty cell. Numbers are written as text (`"2.5"`), exactly as entered. A row may
  be shorter than `columns`: the missing cells are empty.
- A grouped table names its sub-columns `<group>:<sub-column>` (`"A:Y1"`) and gives
  `groups` and `replicates` (sub-columns per group).

Optional fields:

| Field | Meaning |
| --- | --- |
| `excluded` | Cells excluded from analyses and graphs, as `"row,column"` (0-based, column 0 is Title): `["2,1"]` |
| `seriesColors` | A color per column (or per group of a grouped table): `{"Control": "red"}` |
| `pointColors` | A color per cell, as `"column name#row"`: `{"Control#3": "green"}` |
| `widths` | Column widths set by the user, in pixels, by column name |
| `freezeTitle` | `true` keeps the Title column visible while scrolling |

Colors are `"blue"`, `"red"`, `"green"`, `"purple"`, `"orange"` or `"black"`.

### Analysis

```json
{
  "id": "analysis_k3m4", "type": "analysis", "name": "Analysis 1", "parentId": "table_x1y2",
  "analysisType": "two-way-anova",
  "analysisParams": { "design": "ordinary", "posthoc": "tukey", "posthocTarget": "groups" }
}
```

An analysis stores what to compute, never its results: Helix computes them again
from the table when the file opens, so results always match the data.
`analysisParams` holds the choices made in the analysis's wizard (see
`src/stats/types.ts`).

### Graph

```json
{
  "id": "graph_p5q6", "type": "graph", "name": "Graph 1", "parentId": "table_x1y2",
  "graphType": "grouped-bars",
  "graphOptions": { "center": "mean", "error": "sem", "width": 640, "height": 460, … }
}
```

`graphOptions` holds every display setting (see `GraphOptions` in
`src/store/types.ts`). A missing setting takes its default.
