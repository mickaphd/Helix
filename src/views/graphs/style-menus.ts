// The Format panel's native menus of colors, shapes, dashes and patterns: a graph's
// palette, a series' color, shape, dashes and pattern, every point's shape and every
// line's dashes, an outline's color, the selected points' style. Each line shows what
// it picks, drawn here as a picture.
import {
  SAME_AS_FILL,
  type FillPattern,
  type GraphPalette,
  type LineDash,
  type PointShape,
  type PointStyle,
} from "../../store/types";
import { PALETTES, swatchesOf, withOpacity, type Palette } from "../../lib/palettes";
import { popupMenu, type Picture } from "../../native";
import { separator } from "../../menus";
import { POINT_SIZE, TINT, visibleOutline } from "./plot-helpers";

const HEIGHT = 36; // 18 points on Retina, a menu line's picture height
// Seen on a light menu and a dark one alike: the chosen item's ring in the accent
// color, the graph-wide shapes in macOS's mid gray.
const ring = () => getComputedStyle(document.documentElement).getPropertyValue("--accent");
const NEUTRAL = "#8E8E93";

function picture(width: number, draw: (g: CanvasRenderingContext2D) => void): Picture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = HEIGHT;
  const g = canvas.getContext("2d")!;
  draw(g);
  return { rgba: new Uint8Array(g.getImageData(0, 0, width, HEIGHT).data.buffer), width, height: HEIGHT };
}

/** A palette's colors side by side, or a gradient's as one band; outlined when chosen. */
function strip(palette: Palette, chosen: boolean): Picture {
  return picture(176, (g) => {
    const [x, y, w, h] = [4, 6, 168, 24];
    g.beginPath();
    g.roundRect(x, y, w, h, 5);
    g.save();
    g.clip();
    const { colors } = palette;
    if (palette.kind === "categorical") {
      colors.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect(x + (i * w) / colors.length, y, w / colors.length + 1, h);
      });
    } else {
      // Blended between its colors, as the heatmap draws it.
      const band = g.createLinearGradient(x, 0, x + w, 0);
      colors.forEach((c, i) => band.addColorStop(i / (colors.length - 1), c));
      g.fillStyle = band;
      g.fillRect(x, y, w, h);
    }
    g.restore();
    g.lineWidth = chosen ? 3 : 1;
    g.strokeStyle = chosen ? ring() : "rgba(0,0,0,0.25)";
    g.stroke();
  });
}

/** Each point shape as an SVG path in a 36 × 36 box: drawn in the menus and the panel. */
export const SHAPE_PATHS: Record<PointShape, string> = {
  circle: "M30 18A12 12 0 1 1 6 18A12 12 0 1 1 30 18Z",
  square: "M8 8H28V28H8Z",
  diamond: "M18 4L32 18L18 32L4 18Z",
  "triangle-up": "M18 5L31 29H5Z",
  "triangle-down": "M5 7H31L18 31Z",
};
const SHAPES = Object.keys(SHAPE_PATHS) as PointShape[];

/** `shape` filled with `color`, ringed when chosen. */
function mark(color: string, shape: PointShape, chosen: boolean): Picture {
  return picture(HEIGHT, (g) => {
    const path = new Path2D(SHAPE_PATHS[shape]);
    g.fillStyle = color;
    g.fill(path);
    g.lineWidth = chosen ? 3 : 1;
    g.strokeStyle = chosen ? ring() : "rgba(0,0,0,0.25)";
    g.stroke(path);
  });
}

/** Menu lines picking each shape, drawn in `color`. */
const shapeItems = (color: string, current: PointShape, pick: (shape: PointShape) => void) =>
  SHAPES.map((shape) => ({ text: "", icon: mark(color, shape, shape === current), action: () => pick(shape) }));

/** Each line's dashes in a 36-pixel picture: on and off lengths. */
export const DASH_ARRAYS: Record<LineDash, number[]> = { solid: [], dash: [7, 4], dot: [2, 4], dashdot: [7, 3, 2, 3] };
const DASHES = Object.keys(DASH_ARRAYS) as LineDash[];

/** Each fill pattern as a path in an 8 × 8 tile, repeated (the menus' and the panel's). */
export const PATTERN_PATHS: Record<FillPattern, string> = {
  diagonal: "M0 8L8 0M-2 2L2 -2M6 10L10 6",
  "back-diagonal": "M0 0L8 8M-2 6L2 10M6 -2L10 2",
  crosshatch: "M0 8L8 0M-2 2L2 -2M6 10L10 6M0 0L8 8M-2 6L2 10M6 -2L10 2",
  horizontal: "M0 4H8",
  vertical: "M4 0V8",
  grid: "M0 4H8M4 0V8",
  dots: "M4.8 4A0.8 0.8 0 1 1 3.2 4A0.8 0.8 0 1 1 4.8 4Z",
};
const PATTERNS = Object.keys(PATTERN_PATHS) as FillPattern[];

/** The chosen item's ring round a square picture. */
function ringed(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.roundRect(2, 2, 32, 32, 6);
  g.lineWidth = 3;
  g.strokeStyle = ring();
  g.stroke();
}

/** A line with `dash` in `color`, ringed when chosen. */
function dashLine(color: string, dash: LineDash, chosen: boolean): Picture {
  return picture(HEIGHT, (g) => {
    g.beginPath();
    g.moveTo(6, 18);
    g.lineTo(30, 18);
    g.setLineDash(DASH_ARRAYS[dash]);
    g.lineWidth = 3;
    g.strokeStyle = color;
    g.stroke();
    g.setLineDash([]);
    if (chosen) ringed(g);
  });
}

/** A chip tinted with `color` under `pattern`, as a patterned bar is drawn; ringed when chosen. */
function patterned(color: string, pattern: FillPattern | undefined, chosen: boolean): Picture {
  return picture(HEIGHT, (g) => {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 8;
    const t = tile.getContext("2d")!;
    t.strokeStyle = color;
    t.lineWidth = 1.5;
    if (pattern) t.stroke(new Path2D(PATTERN_PATHS[pattern]));
    g.beginPath();
    g.roundRect(7, 7, 22, 22, 3);
    g.fillStyle = withOpacity(color, TINT);
    g.fill();
    g.fillStyle = g.createPattern(tile, "repeat")!;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = color;
    g.stroke();
    if (chosen) ringed(g);
  });
}

/** A line's dashes, drawn in `color` (every line's: a neutral gray). */
export const chooseDash = (current: LineDash, pick: (dash: LineDash) => void, color = NEUTRAL) =>
  popupMenu(DASHES.map((dash) => ({ text: "", icon: dashLine(color, dash, dash === current), action: () => pick(dash) })));

const KINDS = [
  ["categorical", "Categorical"],
  ["sequential", "Sequential"],
  ["diverging", "Diverging"],
] as const;

/** The palettes, under their kind (only gradients when `gradients`), then whether the
 *  graph takes the colors from the last. */
export function choosePalette(current: GraphPalette, gradients: boolean, pick: (palette: Palette) => void, reverse: () => void) {
  const kinds = KINDS.filter(([kind]) => !gradients || kind !== "categorical");
  return popupMenu([
    ...kinds.flatMap(([kind, title], i) => [
      ...(i > 0 ? [separator] : []),
      { text: title, enabled: false },
      ...PALETTES.filter((p) => p.kind === kind).map((p) => ({
        text: p.label,
        icon: strip(p, p.name === current.name),
        action: () => pick(p),
      })),
    ]),
    separator,
    { text: "Reverse Colors", checked: current.reversed === true, action: reverse },
  ]);
}

/** A series' color among the palette's swatches, the current one ringed. */
export const chooseSwatch = (palette: GraphPalette, current: string, pick: (color: string) => void) =>
  popupMenu(
    swatchesOf(palette).map((c) => ({
      text: "",
      icon: mark(c, "circle", c.toLowerCase() === current.toLowerCase()),
      action: () => pick(c),
    })),
  );

/** A pattern over a series' fill (or none), drawn in its `color`. */
export const choosePattern = (color: string, current: FillPattern | undefined, pick: (pattern: FillPattern | undefined) => void) =>
  popupMenu(
    [undefined, ...PATTERNS].map((pattern) => ({
      text: "",
      icon: patterned(color, pattern, pattern === current),
      action: () => pick(pattern),
    })),
  );

// Outlines and error bars are often black, gray or white, whatever the palette.
const NEUTRALS = ["#000000", "#808080", "#FFFFFF"];

/** Menu lines picking the color of an outline or error bars (`current`; none is
 *  `SAME_AS_FILL`): first the color they take by default (`same` names it), then black,
 *  gray and white, then the palette's swatches. */
function colorItems(palette: GraphPalette, current: string | undefined, same: string, pick: (color: string) => void) {
  const chosen = current ?? SAME_AS_FILL;
  const swatch = (c: string) => ({ text: "", icon: mark(c, "circle", c.toLowerCase() === chosen.toLowerCase()), action: () => pick(c) });
  return [
    { text: same, checked: chosen === SAME_AS_FILL, action: () => pick(SAME_AS_FILL) },
    separator,
    ...NEUTRALS.map(swatch),
    separator,
    ...swatchesOf(palette).filter((c) => !NEUTRALS.includes(c.toUpperCase())).map(swatch),
  ];
}

/** The color of an outline or error bars, from a native menu. */
export const chooseColor = (palette: GraphPalette, current: string | undefined, same: string, pick: (color: string) => void) =>
  popupMenu(colorItems(palette, current, same, pick));

/** The selected points' menu, in the Selected points section's order: their color,
 *  shape, size, fill and outline color (as `current`, the first one's), their names
 *  shown or not, and a reset. */
export function chooseSelectionStyle(
  palette: GraphPalette,
  current: { color: string; shape: PointShape; size: number; fill: number; outline: number; outlineColor: string; label: boolean },
  act: { style: (style: PointStyle) => void; resize: (by: number) => void; reset: () => void },
) {
  return popupMenu([
    {
      text: "Color",
      items: swatchesOf(palette).map((c) => ({
        text: "",
        icon: mark(c, "circle", c.toLowerCase() === current.color.toLowerCase()),
        action: () => act.style({ color: c }),
      })),
    },
    { text: "Shape", items: shapeItems(current.color, current.shape, (shape) => act.style({ shape })) },
    // The Size stepper's + and −, as in the Selected points section.
    { text: "Bigger", enabled: current.size < POINT_SIZE.max, action: () => act.resize(1) },
    { text: "Smaller", enabled: current.size > POINT_SIZE.min, action: () => act.resize(-1) },
    // The Fill stepper's values, by 10 %.
    {
      text: "Fill",
      items: Array.from({ length: 11 }, (_, i) => 100 - i * 10).map((percent) => ({
        text: `${percent}%`,
        checked: Math.round(current.fill * 100) === percent,
        action: () => act.style({ fill: percent / 100 }),
      })),
    },
    {
      text: "Outline Color",
      items: colorItems(palette, current.outlineColor, "Same as Fill", (outlineColor) => {
        const outline = visibleOutline(current.outline, outlineColor);
        act.style({ outlineColor, ...(outline && { outline }) });
      }),
    },
    { text: "Show Label", checked: current.label, action: () => act.style({ label: current.label ? undefined : true }) },
    separator,
    { text: "Reset Style", action: act.reset },
  ]);
}

/** Points' shape, drawn in `color` (every point's: a neutral gray). */
export const chooseShape = (current: PointShape, pick: (shape: PointShape) => void, color = NEUTRAL) =>
  popupMenu(shapeItems(color, current, pick));
