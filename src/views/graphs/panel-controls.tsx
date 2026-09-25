// The compact controls of a graph's Format panel: one labelled row each.
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button, Input, Segmented, Select, Switch, cn } from "../../ui/controls";
import { Row } from "../../components/common/inspector";
import { PALETTE_HEX, PALETTE_LABEL, PALETTE_ORDER } from "../../lib/palette";
import type { GraphOptions, PaletteColor } from "../../store/types";

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

/** One series' name + a strip of clickable palette swatches. Clicking the already-
 *  selected swatch clears the override (back to palette-by-position default). */
export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PaletteColor;
  onChange: (token: PaletteColor | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-small text-primary">{label}</span>
      <div className="flex items-center gap-1.5">
        {PALETTE_ORDER.map((token) => {
          const selected = value === token;
          return (
            <button
              key={token}
              type="button"
              title={PALETTE_LABEL[token]}
              onClick={() => onChange(selected ? undefined : token)}
              className={cn(
                // Selected swatch is larger with an accent ring; unselected ones
                // shrink and dim — same visual language as the table's Color menu.
                "rounded-full border-2 transition-all",
                selected
                  ? "size-5 border-primary"
                  : "size-3.5 border-transparent opacity-70 hover:opacity-100",
              )}
              style={{ backgroundColor: PALETTE_HEX[token] }}
            />
          );
        })}
      </div>
    </div>
  );
}

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
        <span className="w-8 text-center text-small tabular-nums">{value}</span>
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
