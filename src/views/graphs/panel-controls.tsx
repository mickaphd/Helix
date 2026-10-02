// The compact controls of a graph's Format panel: one labelled row each.
import * as React from "react";
import { CaretUpDownIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { Button, Input, Segmented, Select, Switch, cn } from "../../ui/controls";
import { Row } from "../../components/common/inspector";
import { colorName, paletteNamed, type Palette } from "../../lib/palettes";
import { TINT, visibleOutline } from "./plot-helpers";
import {
  chooseColor,
  chooseDash,
  choosePalette,
  choosePattern,
  chooseShape,
  chooseSwatch,
  DASH_ARRAYS,
  PATTERN_PATHS,
  SHAPE_PATHS,
} from "./style-menus";
import {
  SAME_AS_FILL,
  type FillPattern,
  type GraphOptions,
  type GraphPalette,
  type LineDash,
  type PointShape,
  type SeriesStyle,
} from "../../store/types";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type SetOptions = (patch: Partial<GraphOptions>) => void;

export function TextRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="None"
      />
    </Row>
  );
}

/** A palette's colors in a small band: side by side, or blended along a gradient. */
function PaletteBand({ palette }: { palette: GraphPalette }) {
  const { kind, colors } = palette;
  const background =
    kind === "categorical"
      ? `linear-gradient(to right, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(", ")})`
      : `linear-gradient(to right, ${colors.join(", ")})`;
  return <span className="h-3 w-16 shrink-0 rounded-sm border border-black/15" style={{ background }} />;
}

/** The graph's palette: a native menu of them all (only gradients when `gradients`),
 *  and Reverse Colors. */
export function PaletteRow({
  value,
  gradients,
  onChange,
  onReverse,
}: {
  value: GraphPalette;
  gradients: boolean;
  onChange: (palette: Palette) => void;
  onReverse: () => void;
}) {
  return (
    <Row label="Palette">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-2 rounded-md bg-control px-2 text-regular"
        onClick={() => void choosePalette(value, gradients, onChange, onReverse)}
      >
        <span className="truncate">{paletteNamed(value.name)?.label ?? value.name}</span>
        <span className="flex-1" />
        <PaletteBand palette={value} />
        <CaretUpDownIcon className="size-3.5 shrink-0 text-secondary" />
      </button>
    </Row>
  );
}

// Every mark of the panel (color, shape, line, pattern) fills about 80 % of its 20 px
// box, so they look the same size side by side.

/** A point shape, drawn as in the menus (a circle's 24 of the 30 shown). */
function ShapeIcon({ shape, color }: { shape: PointShape; color: string }) {
  return (
    <svg viewBox="3 3 30 30" className="size-5 shrink-0">
      <path d={SHAPE_PATHS[shape]} fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth={1.5} />
    </svg>
  );
}

/** A painter's palette filled with `color`: Phosphor's Palette, its outline only. */
function ColorIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 256 256" className="size-5 shrink-0">
      <path
        d="M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89Z"
        fill={color}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth={12}
      />
    </svg>
  );
}

/** A line with its dashes, drawn as in the menus. */
function LineIcon({ dash, color }: { dash: LineDash; color: string }) {
  return (
    <svg viewBox="0 0 36 36" className="size-5 shrink-0">
      <path d="M4 18H32" stroke={color} strokeWidth={3} strokeDasharray={DASH_ARRAYS[dash].join(" ")} />
    </svg>
  );
}

/** A chip tinted with `color` under its pattern, as in the menus. */
function PatternIcon({ color, pattern }: { color: string; pattern?: FillPattern }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0">
      <pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse">
        {pattern && <path d={PATTERN_PATHS[pattern]} stroke={color} strokeWidth={1.5} />}
      </pattern>
      <rect x={2} y={2} width={16} height={16} rx={2} fill={color} fillOpacity={TINT} stroke={color} />
      <rect x={2} y={2} width={16} height={16} rx={2} fill={`url(#${id})`} />
    </svg>
  );
}

/** What a series offers besides its color, while the graph draws it: its points'
 *  shape, its line's dashes, the pattern over its fill. */
interface SeriesOffer {
  shape?: boolean;
  dash?: boolean;
  pattern?: boolean;
}

// The columns of the series' rows, in order, and what heads each.
const COLUMNS = [
  ["color", "Color"],
  ["shape", "Shape"],
  ["dash", "Line"],
  ["pattern", "Pattern"],
] as const;
const CELL = "flex w-12 shrink-0 justify-center";

/** What each column of the series' rows sets, above them. */
export function SeriesHeader({ offer }: { offer: SeriesOffer }) {
  return (
    <div className="flex items-center gap-1">
      <span className="flex-1" />
      {COLUMNS.filter(([key]) => key === "color" || offer[key]).map(([key, title]) => (
        <span key={key} className={cn(CELL, "text-small text-secondary")}>
          {title}
        </span>
      ))}
    </div>
  );
}

/** A button drawn as what it picks (`icon`), opening a native menu of pictures. */
const PictureButton = ({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick}>
    {icon}
  </button>
);

/** One series' name, then one button per thing it offers, each its own native menu:
 *  its color, then its points' shape, its line's dashes, its fill's pattern. Every
 *  series offers the same, so the buttons line up in columns under `SeriesHeader`. Only
 *  the color is drawn in color: the others in gray, so the columns read apart (their
 *  menus show the series' color). */
export function SeriesRow({
  label,
  palette,
  style,
  offer,
  onChange,
}: {
  label: string;
  palette: GraphPalette;
  style: { color: string; shape: PointShape; dash: LineDash; pattern?: FillPattern };
  offer: SeriesOffer;
  onChange: (style: SeriesStyle) => void;
}) {
  const { color } = style;
  const cell = (button: React.ReactNode) => <span className={CELL}>{button}</span>;
  return (
    <div className="flex items-center gap-1 text-secondary">
      <span className="flex-1 truncate text-small text-primary">{label}</span>
      {cell(
        <PictureButton
          label={`${label} color: ${colorName(palette, color)}`}
          icon={<ColorIcon color={color} />}
          onClick={() => void chooseSwatch(palette, color, (c) => onChange({ color: c }))}
        />,
      )}
      {offer.shape &&
        cell(
          <PictureButton
            label={`${label} shape`}
            icon={<ShapeIcon shape={style.shape} color="currentColor" />}
            onClick={() => void chooseShape(style.shape, (shape) => onChange({ shape }), color)}
          />,
        )}
      {offer.dash &&
        cell(
          <PictureButton
            label={`${label} line`}
            icon={<LineIcon dash={style.dash} color="currentColor" />}
            onClick={() => void chooseDash(style.dash, (dash) => onChange({ dash }), color)}
          />,
        )}
      {offer.pattern &&
        cell(
          <PictureButton
            label={`${label} pattern`}
            icon={<PatternIcon color="currentColor" pattern={style.pattern} />}
            onClick={() => void choosePattern(color, style.pattern, (pattern) => onChange({ pattern }))}
          />,
        )}
    </div>
  );
}

/** A color picked from a native menu, or none (or `SAME_AS_FILL`): the color it takes
 *  by default, which `same` names ("Same as Fill"). Shown as a ring of the color. */
export function ColorRow({
  label,
  palette,
  color,
  same,
  onChange,
}: {
  label: string;
  palette: GraphPalette;
  color: string | undefined;
  same: string;
  onChange: (color: string) => void;
}) {
  const chosen = color && color !== SAME_AS_FILL ? color : undefined;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-small text-secondary">{label}</span>
      <button
        type="button"
        title={chosen && colorName(palette, chosen)}
        aria-label={label}
        className="text-small text-secondary"
        onClick={() => void chooseColor(palette, color, same, onChange)}
      >
        {!chosen ? (
          same
        ) : (
          <svg viewBox="0 0 36 36" className="size-5 shrink-0">
            <circle cx="18" cy="18" r="13" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={9} />
            <circle cx="18" cy="18" r="13" fill="none" stroke={chosen} strokeWidth={6} />
          </svg>
        )}
      </button>
    </div>
  );
}

/** A thickness in pixels, by half pixels up to 6, from 0 (none) when it can be none:
 *  outlines, lines, error bars, axes. */
export function ThicknessRow({
  label,
  value,
  none,
  onChange,
}: {
  label: string;
  value: number;
  none?: boolean;
  onChange: (v: number) => void;
}) {
  return <Stepper label={label} value={value} min={none ? 0 : 0.5} max={6} step={0.5} onChange={onChange} />;
}

/** A share in steps of 10 %, up to `max` (1 = 100 %): how opaque a fill is, how wide a gap. */
export function PercentRow({
  label,
  value,
  max = 1,
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Stepper
      label={`${label} (%)`}
      value={Math.round(value * 100)}
      min={0}
      max={max * 100}
      step={10}
      onChange={(v) => onChange(v / 100)}
    />
  );
}

/** An outline: its thickness, and its color (`width` comes with it when an outline of
 *  none must show). The same rows for shapes, points and selected points. */
export function OutlineRows({
  palette,
  width,
  color,
  onWidth,
  onColor,
}: {
  palette: GraphPalette;
  width: number;
  color: string | undefined;
  onWidth: (width: number) => void;
  onColor: (color: string, width?: number) => void;
}) {
  return (
    <>
      <ThicknessRow label="Outline" value={width} none onChange={onWidth} />
      <ColorRow
        label="Outline color"
        palette={palette}
        color={color}
        same="Same as Fill"
        onChange={(c) => onColor(c, visibleOutline(width, c))}
      />
    </>
  );
}

/** A titled group of rows inside a section: what they all draw (Bars, Points…). */
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-small font-medium text-primary">{title}</span>
      {children}
    </div>
  );
}

/** A choice drawn as a picture (`icon`), from a native menu of pictures. */
function PickRow({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-primary">
      <span className="text-small text-secondary">{label}</span>
      <PictureButton label={label} icon={icon} onClick={onClick} />
    </div>
  );
}

/** The shape of every point. */
export const ShapeRow = ({ value, onChange }: { value: PointShape; onChange: (shape: PointShape) => void }) => (
  <PickRow label="Shape" icon={<ShapeIcon shape={value} color="currentColor" />} onClick={() => void chooseShape(value, onChange)} />
);

/** The dashes of every line. */
export const DashRow = ({ value, onChange }: { value: LineDash; onChange: (dash: LineDash) => void }) => (
  <PickRow label="Dash" icon={<LineIcon dash={value} color="currentColor" />} onClick={() => void chooseDash(value, onChange)} />
);

/** Round Plotly's computed range/step to a sane display precision. */
const roundDisplay = (n: number) => Math.round(n * 1000) / 1000;

/** A number field, blank for Auto (showing the automatic value). It applies when left
 *  or on Return, so the graph doesn't redraw for each digit typed. */
export function NumRow({
  label,
  value,
  autoValue,
  onChange,
}: {
  label: string;
  value?: number;
  autoValue?: number;
  onChange: (v?: number) => void;
}) {
  const shown = String(value ?? (autoValue != null ? roundDisplay(autoValue) : ""));
  return (
    <Row label={label}>
      <Input
        // A new key when the value changes elsewhere (Reset, a new Auto range) shows it.
        key={shown}
        type="number"
        defaultValue={shown}
        placeholder="Auto"
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={(e) => {
          const typed = e.currentTarget.value;
          if (typed === shown) return;
          if (typed === "") onChange(undefined);
          else if (Number.isFinite(Number(typed))) onChange(Number(typed));
        }}
      />
    </Row>
  );
}

/** A labelled single-select row built on SegmentedControl. */
export function Choice<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
}) {
  return (
    <Row label={label}>
      <Segmented value={value} onChange={onChange} options={items} />
    </Row>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-small text-secondary">{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

/** A minimalist −/value/+ stepper (native +/- buttons) for a bounded numeric option.
 *  `step` may be fractional, so results are rounded to avoid float drift (0.5 + 0.5 …). */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const round = (n: number) => Math.round(n / step) * step;
  return (
    <div className="flex items-center justify-between">
      <span className="text-small text-secondary">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          disabled={value <= min}
          onClick={() => onChange(clamp(round(value - step), min, max))}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <MinusIcon className="size-3.5" />
        </Button>
        <span className="w-9 text-center text-small tabular-nums">{value}</span>
        <Button
          size="icon"
          disabled={value >= max}
          onClick={() => onChange(clamp(round(value + step), min, max))}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** A labelled column-picker Select. `allowNone` adds a "None" option (→ undefined). */
export function ColumnSelectRow({
  label,
  value,
  names,
  allowNone,
  onChange,
}: {
  label: string;
  value?: string;
  names: string[];
  allowNone?: boolean;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Row label={label}>
      <Select
        value={value ?? ""}
        onChange={(v) => onChange(v || undefined)}
        placeholder={allowNone ? "None" : "Choose…"}
        options={names.map((n) => ({ value: n, label: n }))}
      />
    </Row>
  );
}

/** The drawing's width × height in px. A field applies when left or on Return, so a
 *  number half typed (the "6" of "640") isn't clamped on the way. */
export function SizeRow({
  width,
  height,
  limits,
  onChange,
}: {
  width: number;
  height: number;
  limits: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };
  onChange: (size: { width: number; height: number }) => void;
}) {
  const field = (key: "width" | "height", value: number, min: number, max: number) => (
    <Input
      // A new key when the size changes elsewhere (dragging an axis) shows the new value.
      key={value}
      type="number"
      aria-label={key === "width" ? "Width" : "Height"}
      defaultValue={value}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={(e) => {
        const typed = e.currentTarget.valueAsNumber;
        const next = Number.isFinite(typed) ? clamp(Math.round(typed), min, max) : value;
        e.currentTarget.value = String(next);
        if (next !== value) onChange({ width, height, [key]: next });
      }}
    />
  );
  return (
    <Row label="Size (px)">
      <div className="flex items-center gap-1.5">
        {field("width", width, limits.minWidth, limits.maxWidth)}
        <span className="text-small text-secondary">×</span>
        {field("height", height, limits.minHeight, limits.maxHeight)}
      </div>
    </Row>
  );
}
