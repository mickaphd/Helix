// The grid's right-click menu (a native macOS menu). What it offers depends
// on where the click landed: a cell, a row number, or a column header.
// Deleting rows or columns is only offered from their own header, so a stray
// right-click on a cell can't lose data.
import type { TableData, TableType } from "../../store/types";
import type { TableMove } from "../../store/references";
import type { MenuItems } from "../../native";
import {
  convertCommaDecimals,
  deleteColumns,
  deleteRows,
  hasCommaDecimals,
  insertColumns,
  insertRows,
  isGrouped,
  isRangeExcluded,
  rowsDeleted,
  rowsInserted,
  toggleExcluded,
  type Range,
} from "./table-data";

export type MenuZone = "cell" | "row" | "column";

type Item = MenuItems[number];

const SEPARATOR = { item: "Separator" } as const;

const plural = (n: number, word: string) => (n > 1 ? `${n} ${word}s` : word);

interface MenuContext {
  data: TableData;
  type: TableType;
  zone: MenuZone;
  range: Range;
  /** Applies an edit, named for Undo. */
  update: (next: TableData, label: string, move?: TableMove) => void;
  rename: (column: number) => void;
  configure: () => void;
}

export function gridMenu({ data, type, zone, range, update, rename, configure }: MenuContext): MenuItems {
  const grouped = isGrouped(data);
  const rows = range.r1 - range.r0 + 1;
  const cols = range.c1 - range.c0 + 1;
  // Row titles (and an XY table's X column) stay first: nothing is inserted before them or deletes them.
  const firstData = Math.max(type === "xy" ? 2 : 1, range.c0);
  // Column actions need a stored column: the empty ones shown beyond have nothing to act on.
  const onCells = zone !== "row" && range.c0 < data.columns.length;
  const exclude = isRangeExcluded(data, range) ? "Include in Analysis" : "Exclude from Analysis";
  const items: Item[] = [
    { text: exclude, accelerator: "CmdOrCtrl+E", action: () => update(toggleExcluded(data, range), exclude) },
    SEPARATOR,
    { item: "Cut" },
    { item: "Copy" },
    { item: "Paste" },
  ];

  if (zone !== "column") {
    items.push(
      SEPARATOR,
      {
        text: `Insert ${plural(rows, "Row")} Above`,
        action: () => update(insertRows(data, range.r0, rows), `Insert ${plural(rows, "Row")}`, { rows: rowsInserted(range.r0, rows) }),
      },
      {
        text: `Insert ${plural(rows, "Row")} Below`,
        action: () =>
          update(insertRows(data, range.r1 + 1, rows), `Insert ${plural(rows, "Row")}`, { rows: rowsInserted(range.r1 + 1, rows) }),
      },
    );
  }

  if (onCells && !grouped) {
    items.push(
      SEPARATOR,
      {
        text: `Insert ${plural(cols, "Column")} Left`,
        action: () => update(insertColumns(data, firstData, cols, type), `Insert ${plural(cols, "Column")}`),
      },
      {
        text: `Insert ${plural(cols, "Column")} Right`,
        action: () => update(insertColumns(data, range.c1 + 1, cols, type), `Insert ${plural(cols, "Column")}`),
      },
    );
  }

  if (onCells) {
    items.push(SEPARATOR, { text: grouped && range.c0 > 0 ? "Rename Group…" : "Rename Column…", action: () => rename(range.c0) });

  }

  if (zone === "column" && range.c0 === 0) {
    items.push(SEPARATOR, {
      text: "Keep Visible When Scrolling",
      checked: Boolean(data.freezeTitle),
      action: () => update({ ...data, freezeTitle: data.freezeTitle ? undefined : true }, "Keep Visible"),
    });
  }

  if (grouped) items.push(SEPARATOR, { text: "Configure Table…", action: configure });

  if (zone === "row") {
    const text = `Delete ${plural(rows, "Row")}`;
    items.push(SEPARATOR, { text, action: () => update(deleteRows(data, range.r0, rows), text, { rows: rowsDeleted(range.r0, rows) }) });
  }
  if (zone === "column" && !grouped && onCells && range.c1 >= firstData) {
    const count = Math.min(range.c1, data.columns.length - 1) - firstData + 1;
    items.push(SEPARATOR, {
      text: `Delete ${plural(count, "Column")}`,
      action: () => update(deleteColumns(data, firstData, count), `Delete ${plural(count, "Column")}`),
    });
  }
  if (hasCommaDecimals(data)) {
    const text = "Convert Decimal Commas to Points";
    items.push(SEPARATOR, { text, action: () => update(convertCommaDecimals(data), text) });
  }
  return items;
}
