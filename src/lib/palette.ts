// Shared 6-swatch series palette — used by every graph family (as the fill/border
// colors of points, bars, boxes, lines) and by the table's column/group right-click
// menu. One hex per token: 100% opacity for borders/lines, 50% alpha for fills.
import type { PaletteColor } from "../store/types";

export const PALETTE_ORDER: PaletteColor[] = ["blue", "red", "green", "purple", "orange", "black"];

export const PALETTE_HEX: Record<PaletteColor, string> = {
  blue: "#8195FC",
  red: "#f87171",
  green: "#4ade80",
  purple: "#a78bfa",
  orange: "#fb923c",
  black: "#6b7280",
};

export const PALETTE_LABEL: Record<PaletteColor, string> = {
  blue: "Blue",
  red: "Red",
  green: "Green",
  purple: "Purple",
  orange: "Orange",
  black: "Gray",
};

const FILL_ALPHA = 0.5;

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Resolve a series' color token: an explicit override by key, else palette-by-position. */
export function resolveColor(
  seriesColors: Record<string, PaletteColor> | undefined,
  key: string,
  index: number,
): PaletteColor {
  return seriesColors?.[key] ?? PALETTE_ORDER[index % PALETTE_ORDER.length];
}

/** Resolved {border, fill} CSS colors for one series (column name or group prefix). */
export function seriesStyle(
  seriesColors: Record<string, PaletteColor> | undefined,
  key: string,
  index: number,
): { color: string; fill: string } {
  const hex = PALETTE_HEX[resolveColor(seriesColors, key, index)];
  return { color: hex, fill: hexToRgba(hex, FILL_ALPHA) };
}

/** Resolve one data point's color: an explicit per-point override, else the series color. */
export function resolvePointColor(
  seriesColors: Record<string, PaletteColor> | undefined,
  pointColors: Record<string, PaletteColor> | undefined,
  pointKey: string,
  seriesKey: string,
  index: number,
): PaletteColor {
  return pointColors?.[pointKey] ?? resolveColor(seriesColors, seriesKey, index);
}

/** Resolved {border, fill} CSS colors for one data point (see `resolvePointColor`). */
export function pointStyle(
  seriesColors: Record<string, PaletteColor> | undefined,
  pointColors: Record<string, PaletteColor> | undefined,
  pointKey: string,
  seriesKey: string,
  index: number,
): { color: string; fill: string } {
  const hex = PALETTE_HEX[resolvePointColor(seriesColors, pointColors, pointKey, seriesKey, index)];
  return { color: hex, fill: hexToRgba(hex, FILL_ALPHA) };
}
