// Single source of truth for "is this cell a number?".
//
// The UI uses it to decide which columns to offer to an analysis and which points
// to plot; the stats code uses it to decide which values to hand to R. They MUST
// agree, or the UI would enable a test on data the stats then silently drop.

/** Accepted cell formats: an optional sign, digits with an optional decimal point
 *  (".5", "2." too), an optional exponent. Anything else is text: a decimal comma
 *  ("1,5") is offered a conversion from the table's right-click menu. */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parse one raw cell into a number, or null if blank/non-numeric. Coerces
 *  defensively: the spreadsheet engine may hand us numbers, not just strings. */
export function parseCell(cell: string | null): number | null {
  const s = cell == null ? "" : String(cell).trim();
  return s && NUMERIC.test(s) ? Number(s) : null;
}
