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
| `widths` | Column widths set by the user, in pixels, by column name |
| `freezeTitle` | `true` keeps the Title column visible while scrolling |

Files from before Helix 1.0.3 may also have `seriesColors`, a color per column (or
group), and `pointColors`, a color per cell as `"column name#row"`, each `"blue"`,
`"red"`, `"green"`, `"purple"`, `"orange"` or `"black"`: Helix reads them as the
colors of the table's graphs (see Graph).

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

A graph's colors and style are its own:

```json
"palette": { "name": "okabe-ito", "kind": "categorical", "colors": ["#000000", "#E69F00", …] },
"series": { "Control": { "color": "#0072B2", "shape": "square", "dash": "dash", "pattern": "diagonal" } },
"points": { "Control#3": { "color": "#D55E00", "size": 11, "shape": "diamond", "outline": 2, "outlineColor": "#000000" } },
"fill": 1, "pointFill": 1, "pointSize": 7, "pointShape": "circle", "pointOutline": 1.5,
"outline": 1.5, "outlineColor": "#000000", "pointOutlineColor": "#FFFFFF", "barGap": 0.1,
"lineWidth": 2, "lineDash": "solid", "errorWidth": 1.5, "errorCaps": 6, "errorColor": "#000000", "errorDirection": "above",
"legend": { "x": 0.8, "y": 0.1 }, "note": { "x": 30, "y": 40 }, "xTitleGap": 12, "yTitleGap": 2
```

- `palette`: which palette (`src/lib/palettes.ts`), and its colors, written out so
  the figure keeps them whatever Helix's list of palettes becomes. `kind` is
  `"categorical"` (colors taken in turn) or `"sequential"` / `"diverging"` (a
  gradient: series take evenly spaced colors along it, a heatmap all of it).
  `reversed: true`: its colors are written from the last (Reverse Colors).
- `series`: the series styled by hand, by column or group name (a volcano's are
  `"down"` and `"up"`): `color`, `shape` of its points, `dash` of its line (`"solid"`,
  `"dash"`, `"dot"`, `"dashdot"`) and `pattern` over its bars, area or slice
  (`"diagonal"`, `"back-diagonal"`, `"crosshatch"`, `"horizontal"`, `"vertical"`,
  `"grid"`, `"dots"`); the others take the palette's color for their place and the
  graph's `pointShape` and `lineDash`.
- `points`: the points styled one by one, as `"column name#row"` (row 0 is the first),
  each with any of `color`, `size`, `shape`, `fill` (how opaque, 0 to 1), `outline`, `outlineColor` (a color, or
  `"fill"`: the point's own color), `label` (`true`: it shows its row's title, or its
  row number, beside it) and `labelOffset` (where that name was moved, in pixels from
  the point, `y` downward); the rest comes from its series and
  the graph. A volcano's genes are their rows alone, `"#row"`; a gene's own style wins
  over its up / down / not significant look. They follow the table: a renamed column,
  inserted or deleted rows.
- `fill`: how opaque bars, boxes, violins and areas are, from 0 to 1; `pointFill`,
  points.
- `pointSize` and `pointOutline` (in pixels) and `pointShape` (`"circle"`, `"square"`,
  `"diamond"`, `"triangle-up"`, `"triangle-down"`): every point of the graph.
- `outline` (in pixels) and `outlineColor`: the outline of bars, boxes, violins, areas
  and pie slices; `pointOutlineColor`, of points. Without a color, an outline takes the
  color of what it outlines.
- `barGap`: on interleaved grouped bars and XY bars, the gap between the bars of a row
  (or of an X), as a fraction of it (0: side by side).
- `lineWidth`, `lineDash`: every series line's thickness (in pixels) and dashes.
- `errorWidth`, `errorCaps` (in pixels), `errorColor` (none: each series' color) and
  `errorDirection` (`"both"` or `"above"`: up, or right on horizontal bars): error bars,
  and the mean or median line drawn with them.
- `legend` and `note`: texts moved by hand. The legend (or a heatmap's color legend),
  as a fraction of the plot area from its bottom-left corner; the note (a fit's
  equation), in pixels from the plot's top-left corner, `y` downward. Without them,
  each sits in its usual place.
- `xTitleGap`, `yTitleGap`: the space in pixels between each axis title and its tick
  labels.

A graph without `palette` comes from Helix 1.0.2 or before: it takes the Helix
palette, its table's `seriesColors`, its old `heatmapColorScale` or
`volcanoColorUp` / `volcanoColorDown` / `volcanoPointSize`, fills at 0.5 (a pie's at 1,
a volcano's points at 0.75), its type's point size and outline, and bars side by side (`barGap` 0),
so it looks as it did.
