// The data grid shared by every table type. Only the visible cells are
// rendered, so it stays fast with tens of thousands of rows. The grid owns the
// selection and the cell being edited; the table's data lives in the project
// store and every change goes through `update` (which Undo can take back).
//
// Layout: everything lives in one scroller. The column headers, the row numbers
// and a frozen Title column are sticky, so macOS moves them together with the
// cells, in the same frame.
import * as React from "react";
import type { TableData, TableType } from "../../store/types";
import type { EditCommand } from "../../app-menu";
import { parseCell } from "../../lib/numeric";
import { seriesKeyOf } from "../../lib/columns";
import { popupMenu } from "../../native";
import { XIcon } from "lucide-react";
import { cn, IconButton } from "../../ui/controls";
import { gridMenu, type MenuZone } from "./grid-menu";
import {
  dataEdge,
  fillRange,
  findCells,
  freshColumnNames,
  isGrouped,
  parseTSV,
  renameColumn,
  renameGroup,
  setColumnWidth,
  toTSV,
  toggleExcluded,
  writeBlock,
  type Range,
} from "./table-data";

const ROW_H = 24;
const HEAD_H = 26;
const GUTTER_W = 48;
const OVERSCAN = 8;
// Empty rows and columns shown beyond the stored ones: the table feels endless.
const EXTRA_ROWS = 1000;
const EXTRA_COLS = 20;

// ── Column widths: set by the user, or fit to the header and the first rows ──

const MIN_W = 64;
const MAX_W = 360;
const SAMPLE_ROWS = 300;
const DRAG_MIN_W = 32;
const ctx = document.createElement("canvas").getContext("2d")!;
ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
const textWidths = new Map<string, number>();

function textWidth(text: string): number {
  let w = textWidths.get(text);
  if (w === undefined) {
    if (textWidths.size > 20_000) textWidths.clear();
    textWidths.set(text, (w = ctx.measureText(text).width));
  }
  return w;
}

/** Width that fits `header` and the values of `rows` in column `c`. */
function fitWidth(rows: TableData["rows"], c: number, header: string): number {
  let w = textWidth(header);
  for (const row of rows) if (row[c]) w = Math.max(w, textWidth(row[c]!));
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(w) + 20));
}

function columnWidths(data: TableData, headers: string[]): number[] {
  const sample = data.rows.slice(0, SAMPLE_ROWS);
  return headers.map((header, c) => data.widths?.[data.columns[c]] ?? fitWidth(sample, c, header));
}

// ── Selection ──────────────────────────────────────────────────────────

type Point = { r: number; c: number };
type Selection = { anchor: Point; focus: Point };

const toRange = ({ anchor, focus }: Selection): Range => ({
  r0: Math.min(anchor.r, focus.r),
  r1: Math.max(anchor.r, focus.r),
  c0: Math.min(anchor.c, focus.c),
  c1: Math.max(anchor.c, focus.c),
});

const inRange = (g: Range, r: number, c: number) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;

/** `typed`: started by typing over the cell, so arrow keys save and move (as in Excel). */
type Editing =
  | { kind: "cell"; r: number; c: number; value: string; typed: boolean }
  | { kind: "column"; c: number; value: string }
  | { kind: "group"; key: string; value: string };

/** Index of the column whose span holds `x` (xs = left edges, ascending). */
function columnAt(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface GridProps {
  data: TableData;
  type: TableType;
  /** `label` names the edit for Undo ("Paste"); `renamed`: the columns or groups it
   *  renamed (old → new), for the analyses and graphs that name them. */
  update: (next: TableData, label: string, renamed?: Record<string, string>) => void;
  configure: () => void;
}

export function Grid({ data, type, update, configure }: GridProps) {
  const grouped = isGrouped(data);
  const replicates = data.replicates ?? 1;
  const headH = HEAD_H * (grouped ? 2 : 1);
  // Shown headers: the stored columns, then (except for grouped tables, whose columns
  // come from their groups) the names new columns would get. Grouped sub-columns show
  // only their part after "A:" — the group row above names the group.
  const headers = React.useMemo(
    () =>
      grouped
        ? data.columns.map((name, c) => (c > 0 ? name.slice(name.indexOf(":") + 1) : name))
        : [...data.columns, ...freshColumnNames(data.columns, type, EXTRA_COLS)],
    [data.columns, grouped, type],
  );
  const nRows = data.rows.length + EXTRA_ROWS;
  const nCols = headers.length;
  // A column being resized shows its new width live; the table stores it on release.
  const [resizing, setResizing] = React.useState<{ c: number; width: number } | null>(null);
  const baseWidths = React.useMemo(() => columnWidths(data, headers), [data, headers]);
  const widths = resizing ? baseWidths.map((w, c) => (c === resizing.c ? resizing.width : w)) : baseWidths;
  const xs = React.useMemo(() => {
    const out = [0];
    for (const w of widths) out.push(out[out.length - 1] + w);
    return out;
  }, [widths]);
  const totalW = xs[nCols];
  const excluded = React.useMemo(() => new Set(data.excluded), [data.excluded]);

  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const findRef = React.useRef<HTMLInputElement>(null);
  const frozen = Boolean(data.freezeTitle);
  const [view, setView] = React.useState({ top: 0, left: 0, width: 800, height: 600 });
  const [sel, setSel] = React.useState<Selection>({ anchor: { r: 0, c: 1 }, focus: { r: 0, c: 1 } });
  const [editing, setEditingState] = React.useState<Editing | null>(null);
  // Mirrors `editing` for finishEdit, which runs twice when saving also blurs the editor.
  const editingRef = React.useRef(editing);
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };
  const range = toRange(sel);
  const active = sel.anchor; // the cell typing goes to, as in Excel

  // Keep the selection inside the table when it shrinks (undo, delete, resize).
  const clampPoint = (p: Point): Point => ({
    r: Math.max(0, Math.min(nRows - 1, p.r)),
    c: Math.max(0, Math.min(nCols - 1, p.c)),
  });
  if (range.r1 >= nRows || range.c1 >= nCols) {
    setSel({ anchor: clampPoint(sel.anchor), focus: clampPoint(sel.focus) });
  }

  // ── Scrolling and virtualization ─────────────────────────────────────

  const syncView = () => {
    const el = scrollerRef.current!;
    setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
  };

  React.useLayoutEffect(() => {
    const observer = new ResizeObserver(syncView);
    observer.observe(scrollerRef.current!);
    return () => observer.disconnect();
  }, []);

  // The cells' viewport: the scroller minus the sticky row numbers and headers.
  const bodyW = view.width - GUTTER_W;
  const bodyH = view.height - headH;
  const frozenW = frozen ? widths[0] : 0;
  const r0 = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const r1 = Math.min(nRows - 1, Math.ceil((view.top + bodyH) / ROW_H) + OVERSCAN);
  const c0 = Math.max(0, columnAt(xs, view.left) - 1);
  const c1 = Math.min(nCols - 1, columnAt(xs, view.left + bodyW) + 1);
  const visibleCols = Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i);

  /** Scrolls just enough to show cell (r, c) outside the sticky parts. */
  const reveal = ({ r, c }: Point) => {
    const el = scrollerRef.current!;
    const h = el.clientHeight - headH;
    const w = el.clientWidth - GUTTER_W;
    const top = r * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + h) el.scrollTop = top + ROW_H - h;
    if (frozen && c === 0) return;
    if (xs[c] < el.scrollLeft + frozenW) el.scrollLeft = xs[c] - frozenW;
    else if (xs[c + 1] > el.scrollLeft + w) el.scrollLeft = xs[c + 1] - w;
  };

  // One input always sits on the active cell and holds the keyboard focus. Idle, it's
  // invisible and empty; the first character typed into it starts editing. Keeping the
  // same element means no keystroke is lost and accents and input methods just work.
  const focusGrid = () => inputRef.current?.focus({ preventScroll: true });

  // ── Editing ──────────────────────────────────────────────────────────

  const write = (r: number, c: number, block: (string | null)[][], label: string) =>
    update(writeBlock(data, r, c, block, type), label);
  const clear = (g: Range, label = "Clear") => update(fillRange(data, g, null), label);

  /** The range, cut at the stored data when it runs to the end of the shown rows or
   *  columns (a whole column or row selected), so fills don't write into empty space. */
  const fillable = (g: Range): Range => ({
    ...g,
    r1: g.r1 === nRows - 1 ? Math.max(g.r0, data.rows.length - 1) : g.r1,
    c1: g.c1 === nCols - 1 ? Math.max(g.c0, data.columns.length - 1) : g.c1,
  });

  /** ⌘D: copies the selection's top row down through it — or, with one row selected,
   *  the row above into it. */
  const fillDown = () => {
    const g = fillable(range);
    const from = g.r0 === g.r1 ? g.r0 - 1 : g.r0;
    if (from < 0) return;
    const source = Array.from({ length: g.c1 - g.c0 + 1 }, (_, i) => data.rows[from]?.[g.c0 + i] ?? null);
    write(from + 1, g.c0, Array.from({ length: g.r1 - from }, () => source), "Fill Down");
  };

  const startEdit = (r: number, c: number, value = data.rows[r]?.[c] ?? "", typed = false) => {
    reveal({ r, c });
    setEditing({ kind: "cell", r, c, value, typed });
    focusGrid();
  };
  const startRename = (c: number) => {
    if (c >= data.columns.length) return; // an empty column gets its name when data is written to it
    const name = data.columns[c];
    if (grouped && c > 0) setEditing({ kind: "group", key: seriesKeyOf(name), value: seriesKeyOf(name) });
    else setEditing({ kind: "column", c, value: name });
  };

  /** Ends editing, saving unless `cancel`, then moves the selection by (dr, dc). */
  const finishEdit = (cancel: boolean, dr = 0, dc = 0) => {
    const ed = editingRef.current;
    if (!ed) return;
    editingRef.current = null;
    const value = ed.value.trim();
    if (!cancel && ed.kind === "cell") {
      if (value !== (data.rows[ed.r]?.[ed.c] ?? "")) write(ed.r, ed.c, [[value || null]], "Typing");
      move(dr, dc, false, { r: ed.r, c: ed.c });
    }
    if (!cancel && ed.kind === "column") {
      update(renameColumn(data, ed.c, value), "Rename Column", { [data.columns[ed.c]]: value });
    }
    if (!cancel && ed.kind === "group") update(renameGroup(data, ed.key, value), "Rename Group", { [ed.key]: value });
    setEditing(null);
    focusGrid();
  };

  /** Moves the active cell (or, extending, the selection's far corner) by (dr, dc). */
  const move = (dr: number, dc: number, extend: boolean, from = extend ? sel.focus : active) => {
    const p = clampPoint({ r: from.r + dr, c: from.c + dc });
    setSel(extend ? { anchor: sel.anchor, focus: p } : { anchor: p, focus: p });
    reveal(p);
  };

  // ── Keyboard, clipboard, edit menu ───────────────────────────────────

  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (editing) {
      if (e.key === "Enter") finishEdit(false, e.shiftKey ? -1 : 1);
      else if (e.key === "Tab") finishEdit(false, 0, e.shiftKey ? -1 : 1);
      else if (e.key === "Escape") finishEdit(true);
      else if (editing.kind === "cell" && editing.typed && arrows[e.key]) finishEdit(false, ...arrows[e.key]);
      else return;
      e.preventDefault();
      return;
    }
    const extend = e.shiftKey && e.key.startsWith("Arrow");
    if (arrows[e.key] && e.metaKey) {
      // ⌘+arrow jumps along the data as in Excel; ⌘⇧+arrow selects up to there.
      const from = extend ? sel.focus : active;
      const to = dataEdge(data, from.r, from.c, ...arrows[e.key]);
      move(to.r - from.r, to.c - from.c, extend, from);
      e.preventDefault();
      return;
    }
    const page = Math.max(1, Math.floor(view.height / ROW_H) - 1);
    const steps: Record<string, [number, number]> = {
      ...arrows,
      PageUp: [-page, 0],
      PageDown: [page, 0],
      Enter: [e.shiftKey ? -1 : 1, 0],
      Tab: [0, e.shiftKey ? -1 : 1],
    };
    if (steps[e.key]) move(...steps[e.key], extend);
    else if (e.key === "Backspace" || e.key === "Delete") clear(range);
    else if (e.key === "F2") startEdit(active.r, active.c);
    else if (e.key === "Escape") setSel({ anchor: active, focus: active });
    else if (e.key === " " && e.shiftKey) setSel({ anchor: { r: range.r0, c: 0 }, focus: { r: range.r1, c: lastCol } });
    else if (e.key === " " && e.ctrlKey) setSel({ anchor: { r: 0, c: range.c0 }, focus: { r: lastRow, c: range.c1 } });
    else return; // other keys type into the input, which starts editing
    e.preventDefault();
  };

  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", toTSV(data, range));
    if (cut) clear(range, "Cut");
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const block = parseTSV(e.clipboardData.getData("text/plain"));
    const single = block.length === 1 && block[0].length === 1;
    // One value pasted over a selection fills it, as in Excel.
    if (single && (range.r0 !== range.r1 || range.c0 !== range.c1)) {
      const g = fillable(range);
      write(g.r0, g.c0, Array.from({ length: g.r1 - g.r0 + 1 }, () => Array(g.c1 - g.c0 + 1).fill(block[0][0])), "Paste");
    } else {
      write(range.r0, range.c0, block, "Paste");
      setSel({
        anchor: { r: range.r0, c: range.c0 },
        focus: clampPoint({ r: range.r0 + block.length - 1, c: range.c0 + block[0].length - 1 }),
      });
    }
  };

  // Commands from the Edit menu (see app-menu.ts), resubscribed with the latest state.
  React.useEffect(() => {
    const onEdit = (e: Event) => {
      const cmd = (e as CustomEvent<EditCommand>).detail;
      const isFind = cmd.startsWith("find");
      if (editing && !isFind) return;
      if (isFind) finishEdit(false);
      if (cmd === "find") (query === null ? openFind() : closeFind());
      else if (cmd === "find-next") findStep(1);
      else if (cmd === "find-previous") findStep(-1);
      else if (cmd === "select-all") setSel({ anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol } });
      else if (cmd === "fill-down") fillDown();
      else if (cmd === "delete") clear(range);
      else if (cmd === "exclude") update(toggleExcluded(data, range), "Exclude / Include");
    };
    window.addEventListener("helix:edit", onEdit);
    return () => window.removeEventListener("helix:edit", onEdit);
  });

  // ── Find ─────────────────────────────────────────────────────────────

  const [query, setQuery] = React.useState<string | null>(null); // null: the find bar is closed
  const matches = React.useMemo(() => (query ? findCells(data, query) : []), [data, query]);
  const current = matches.findIndex((m) => m.r === active.r && m.c === active.c);

  const openFind = () => {
    setQuery(query ?? "");
    requestAnimationFrame(() => findRef.current?.select());
  };
  const closeFind = () => {
    setQuery(null);
    focusGrid();
  };
  /** Selects the next (1) or previous (-1) match after the active cell, wrapping around. */
  const findStep = (dir: 1 | -1) => {
    if (query === null) return openFind();
    if (!matches.length) return;
    const after = (m: Point) => m.r > active.r || (m.r === active.r && m.c > active.c);
    const before = (m: Point) => m.r < active.r || (m.r === active.r && m.c < active.c);
    const m =
      dir === 1
        ? (matches.find(after) ?? matches[0])
        : (matches.findLast(before) ?? matches[matches.length - 1]);
    setSel({ anchor: m, focus: m });
    reveal(m);
  };

  // ── Mouse ────────────────────────────────────────────────────────────

  /** Cell under a pointer event, in table coordinates (clamped). */
  const cellAt = (e: { clientX: number; clientY: number }): Point => {
    const el = scrollerRef.current!;
    const box = el.getBoundingClientRect();
    const x = e.clientX - box.left - GUTTER_W; // from the columns' left edge on screen
    return clampPoint({
      r: Math.floor((e.clientY - box.top - headH + el.scrollTop) / ROW_H),
      c: x < frozenW ? 0 : columnAt(xs, x + el.scrollLeft),
    });
  };

  /** Starts a drag selection: `at` maps the pointer to the selection's focus point. */
  const dragSelect = (e: React.PointerEvent, anchor: Point, at: (e: PointerEvent) => Point, first: Point) => {
    if (e.button !== 0) return;
    if (editing) finishEdit(false);
    const start = e.shiftKey ? sel.anchor : anchor;
    setSel({ anchor: start, focus: first });
    focusGrid();
    const el = scrollerRef.current!;
    const onMove = (ev: PointerEvent) => {
      // Past an edge, scroll so the selection can keep growing.
      const box = el.getBoundingClientRect();
      if (ev.clientY > box.bottom) el.scrollTop += ev.clientY - box.bottom;
      if (ev.clientY < box.top) el.scrollTop -= box.top - ev.clientY;
      if (ev.clientX > box.right) el.scrollLeft += ev.clientX - box.right;
      if (ev.clientX < box.left) el.scrollLeft -= box.left - ev.clientX;
      setSel({ anchor: start, focus: at(ev) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const lastRow = nRows - 1;
  const lastCol = nCols - 1;

  const onCellDown = (e: React.PointerEvent) => {
    const p = cellAt(e);
    dragSelect(e, p, cellAt, p);
  };
  const onColumnDown = (e: React.PointerEvent, c0: number, c1 = c0) =>
    dragSelect(e, { r: 0, c: c0 }, (ev) => ({ r: lastRow, c: cellAt(ev).c }), { r: lastRow, c: c1 });
  const onRowDown = (e: React.PointerEvent) => {
    const r = cellAt(e).r;
    dragSelect(e, { r, c: 0 }, (ev) => ({ r: cellAt(ev).r, c: lastCol }), { r, c: lastCol });
  };

  const showMenu = (e: React.MouseEvent, zone: MenuZone) => {
    e.preventDefault();
    // Right-clicking outside the selection selects what was clicked first.
    const p = cellAt(e);
    let g = range;
    const hit = zone === "cell" ? inRange(g, p.r, p.c) : zone === "row" ? p.r >= g.r0 && p.r <= g.r1 : p.c >= g.c0 && p.c <= g.c1;
    if (!hit) {
      const anchor = zone === "row" ? { r: p.r, c: 0 } : zone === "column" ? { r: 0, c: p.c } : p;
      const focus = zone === "row" ? { r: p.r, c: lastCol } : zone === "column" ? { r: lastRow, c: p.c } : p;
      setSel({ anchor, focus });
      g = toRange({ anchor, focus });
    }
    popupMenu(gridMenu({ data, type, zone, range: g, update, rename: startRename, configure }));
  };

  /** Drag a header's right edge to resize its column; double-click it to fit the content. */
  const resizeHandle = (c: number) =>
    c < data.columns.length && (
      <div
        className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/40"
        onPointerDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startW = widths[c];
          let width = startW;
          const onMove = (ev: PointerEvent) => {
            width = Math.max(DRAG_MIN_W, startW + ev.clientX - startX);
            setResizing({ c, width });
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(null);
            if (width !== startW) update(setColumnWidth(data, c, width), "Column Width");
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          update(setColumnWidth(data, c, fitWidth(data.rows, c, headers[c])), "Column Width");
        }}
      />
    );

  // ── Rendering ────────────────────────────────────────────────────────

  const EDITOR = "absolute z-20 bg-surface px-1.5 text-regular outline-2 -outline-offset-1 outline-accent";

  /** Header editor (renaming a column or group), opened with the name selected. */
  const headerEditor = (value: string, style: React.CSSProperties) => (
    <input
      autoFocus
      onFocus={(e) => e.target.select()}
      value={value}
      style={style}
      className={EDITOR}
      onChange={(e) => editing && setEditing({ ...editing, value: e.target.value })}
      onBlur={() => finishEdit(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Tab") finishEdit(false);
        else if (e.key === "Escape") finishEdit(true);
        else return;
        e.preventDefault();
      }}
    />
  );
  const cellEditing = editing?.kind === "cell" ? editing : null;
  const inputAt = cellEditing ?? active;

  const rows: number[] = [];
  for (let r = r0; r <= r1; r++) rows.push(r);
  const selectedCols = (c: number) => c >= range.c0 && c <= range.c1;
  const selectedRow = (r: number) => r >= range.r0 && r <= range.r1;

  // A frozen column 0 gets its own sticky pane; the main pane lays out the other
  // columns from its left edge.
  const first = frozen ? 1 : 0;
  const inFrozen = (c: number) => frozen && c === 0;
  const box = (c: number, top: number, height: number): React.CSSProperties => ({
    left: inFrozen(c) ? 0 : xs[c] - xs[first],
    top,
    width: widths[c],
    height,
  });
  const mainW = totalW - xs[first];
  const tableH = nRows * ROW_H;
  const mainCols = visibleCols.filter((c) => !inFrozen(c));
  const PANE_EDGE = "bg-surface shadow-[1px_0_0_var(--color-separator)]";

  const headerCell = (c: number) => (
    <div
      key={c}
      className={cn(
        "absolute flex items-center justify-center border-r border-b border-separator px-2 text-secondary",
        selectedCols(c) && "bg-control text-primary",
      )}
      style={box(c, grouped && c > 0 ? HEAD_H : 0, grouped && c === 0 ? headH : HEAD_H)}
      onPointerDown={(e) => onColumnDown(e, c)}
      onDoubleClick={() => startRename(c)}
      onContextMenu={(e) => showMenu(e, "column")}
    >
      <span className="truncate">{headers[c]}</span>
      {resizeHandle(c)}
    </div>
  );

  const cell = (r: number, c: number) => {
    const value = data.rows[r]?.[c];
    return (
      <div
        key={`${r}:${c}`}
        className={cn(
          "absolute truncate border-r border-b border-separator px-1.5 leading-[24px]",
          value && parseCell(value) !== null && "text-right tabular-nums",
          excluded.has(`${r},${c}`) && "text-excluded italic after:content-['*']",
          query && value?.toLowerCase().includes(query.toLowerCase()) && "bg-yellow-300/50",
        )}
        style={box(c, r * ROW_H, ROW_H)}
      >
        {value}
      </div>
    );
  };

  const cellEvents = {
    onPointerDown: onCellDown,
    onDoubleClick: (e: React.MouseEvent) => {
      const p = cellAt(e);
      startEdit(p.r, p.c);
    },
    onContextMenu: (e: React.MouseEvent) => showMenu(e, "cell"),
  };

  const cellInput = (
    <input
      ref={inputRef}
      autoFocus
      aria-label={`${headers[inputAt.c] ?? ""}, row ${inputAt.r + 1}`}
      value={cellEditing?.value ?? ""}
      data-grid-idle={cellEditing ? undefined : ""}
      style={box(inputAt.c, inputAt.r * ROW_H, ROW_H)}
      className={cn(EDITOR, !cellEditing && "opacity-0")}
      onChange={(e) =>
        setEditing(
          cellEditing
            ? { ...cellEditing, value: e.target.value }
            : { kind: "cell", r: active.r, c: active.c, value: e.target.value, typed: true },
        )
      }
      onBlur={() => editingRef.current?.kind === "cell" && finishEdit(false)}
      onKeyDown={onCellKey}
      onCopy={onCopy}
      onCut={(e) => onCopy(e, true)}
      onPaste={onPaste}
    />
  );

  /** The selection tint, the active cell's outline and the input — the parts in a pane. */
  const overlays = (frozenPane: boolean) => {
    const lo = Math.max(range.c0, frozenPane ? 0 : first);
    const hi = Math.min(range.c1, frozenPane ? 0 : nCols - 1);
    return (
      <>
        {lo <= hi && (
          <div
            className="pointer-events-none absolute bg-accent/10 outline outline-accent/60"
            style={{ ...box(lo, range.r0 * ROW_H, (range.r1 - range.r0 + 1) * ROW_H), width: xs[hi + 1] - xs[lo] }}
          />
        )}
        {inFrozen(active.c) === frozenPane && (
          <div
            className="pointer-events-none absolute outline-2 -outline-offset-1 outline-accent"
            style={box(active.c, active.r * ROW_H, ROW_H)}
          />
        )}
        {inFrozen(inputAt.c) === frozenPane && cellInput}
      </>
    );
  };

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden border-t border-separator text-regular"
      // Clicks must not take the focus away from the grid's input.
      onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}
    >
      <div ref={scrollerRef} className="absolute inset-0 overflow-auto overscroll-none" onScroll={syncView}>
        <div style={{ width: GUTTER_W + totalW, height: headH + tableH }}>
          {/* Headers: stuck to the top. */}
          <div className="sticky top-0 z-20 flex" style={{ height: headH }}>
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-b border-separator bg-surface"
              style={{ width: GUTTER_W }}
              onPointerDown={(e) => dragSelect(e, { r: 0, c: 0 }, () => ({ r: lastRow, c: lastCol }), { r: lastRow, c: lastCol })}
            />
            {frozen && (
              <div className={cn("sticky z-10 shrink-0", PANE_EDGE)} style={{ left: GUTTER_W, width: widths[0] }}>
                {headerCell(0)}
                {editing?.kind === "column" && editing.c === 0 && headerEditor(editing.value, box(0, 0, headH))}
              </div>
            )}
            <div className="relative shrink-0 bg-surface" style={{ width: mainW }}>
              {grouped &&
                Array.from({ length: data.groups! }, (_, g) => {
                  const lo = 1 + g * replicates;
                  const hi = lo + replicates - 1;
                  const key = seriesKeyOf(data.columns[lo] ?? "");
                  const span = { ...box(lo, 0, HEAD_H), width: xs[hi + 1] - xs[lo] };
                  return editing?.kind === "group" && editing.key === key ? (
                    <React.Fragment key={g}>{headerEditor(editing.value, span)}</React.Fragment>
                  ) : (
                    <div
                      key={g}
                      className={cn(
                        "absolute truncate border-r border-b border-separator px-2 text-center leading-[26px]",
                        selectedCols(lo) && selectedCols(hi) && "bg-control font-medium",
                      )}
                      style={span}
                      onPointerDown={(e) => onColumnDown(e, lo, hi)}
                      onDoubleClick={() => startRename(lo)}
                      onContextMenu={(e) => showMenu(e, "column")}
                    >
                      {key}
                    </div>
                  );
                })}
              {mainCols.map(headerCell)}
              {editing?.kind === "column" && !inFrozen(editing.c) && headerEditor(editing.value, box(editing.c, 0, headH))}
            </div>
          </div>

          {/* Row numbers (stuck to the left), then the cells. */}
          <div className="flex">
            <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: GUTTER_W, height: tableH }}>
              {rows.map((r) => (
                <div
                  key={r}
                  className={cn(
                    "absolute inset-x-0 border-r border-b border-separator text-center leading-[24px] text-secondary tabular-nums",
                    selectedRow(r) && "bg-control text-primary",
                  )}
                  style={{ top: r * ROW_H, height: ROW_H }}
                  onPointerDown={onRowDown}
                  onContextMenu={(e) => showMenu(e, "row")}
                >
                  {r + 1}
                </div>
              ))}
            </div>
            {frozen && (
              <div
                className={cn("sticky z-10 shrink-0", PANE_EDGE)}
                style={{ left: GUTTER_W, width: widths[0], height: tableH }}
                {...cellEvents}
              >
                {rows.map((r) => cell(r, 0))}
                {overlays(true)}
              </div>
            )}
            <div className="relative shrink-0" style={{ width: mainW, height: tableH }} {...cellEvents}>
              {rows.map((r) => mainCols.map((c) => cell(r, c)))}
              {overlays(false)}
            </div>
          </div>
        </div>
      </div>

      {query !== null && (
        <div className="absolute top-1 right-3 z-30 flex items-center gap-2 rounded-lg bg-surface px-2 py-1 shadow-md ring-1 ring-separator">
          <input
            ref={findRef}
            autoFocus
            placeholder="Find"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") findStep(e.shiftKey ? -1 : 1);
              else if (e.key === "Escape") closeFind();
              else return;
              e.preventDefault();
            }}
            className="h-6 w-44 rounded-md bg-control px-2 text-regular outline-none"
          />
          <span className="w-16 text-small text-secondary tabular-nums">
            {query && (matches.length ? `${current + 1 || "–"} of ${matches.length}` : "No results")}
          </span>
          <IconButton aria-label="Close Find" onClick={closeFind}>
            <XIcon />
          </IconButton>
        </div>
      )}
    </div>
  );
}
