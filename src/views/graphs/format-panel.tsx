// A graph's Format panel. Every graph has the same sections in the same order:
// Statistics · Data · Style · Series · Selected points · Text · Axes · Export. A
// section with nothing for this graph (or no point selected) is left out, the others
// never move. Which sections are open is one
// app-wide preference, kept across graphs and launches; Statistics starts open.
import * as React from "react";
import { ChartBarIcon, CursorClickIcon, ExportIcon, PaintBrushIcon, PaletteIcon, RulerIcon, SigmaIcon, TextTIcon } from "@phosphor-icons/react";
import { Button } from "../../ui/controls";
import { Section } from "../../components/common/inspector";
import { paletteColor, paletteOf, reversedPalette, savedPalette, withoutColors } from "../../lib/palettes";
import type { GraphOptions, PointStyle, SeriesStyle } from "../../store/types";
import { GRAPHS, newGraphOptions } from ".";
import { EXPORT_FORMATS, RESOLUTIONS, type ExportFormat, type Resolution } from "./graph-export";
import { GRAPH_SIZE, POINT_SIZE } from "./plot-helpers";
import { Choice, NumRow, OutlineRows, PercentRow, PaletteRow, SeriesHeader, SeriesRow, SizeRow, Stepper, TextRow, ThicknessRow, Toggle } from "./panel-controls";
import { dataControls, statisticsControls, styleControls, type SectionContext } from "./format-sections";
import { VOLCANO_SERIES } from "./volcano";

type Range = { min: number; max: number; step: number } | null;

/** The points selected on the graph: how many, the first one's style (shown), whether
 *  any has its own, and how to set, resize (each from its own size) or reset theirs. */
interface Selection {
  count: number;
  style: Required<Omit<PointStyle, "labelOffset">>;
  styled: boolean;
  set: (style: PointStyle) => void;
  resize: (by: number) => void;
  reset: () => void;
}

interface Props extends SectionContext {
  setSeriesStyle: (key: string, style: SeriesStyle) => void;
  selection?: Selection;
  /** Plotly's own axis ranges, shown while Min/Max/Step are on Auto. */
  autoX: Range;
  autoY: Range;
  canExport: boolean;
  onSave: (format: ExportFormat, dpi: Resolution) => void;
  onCopy: (dpi: Resolution) => void;
}

// What the Style section sets, put back by its Reset.
const STYLE_OPTIONS: (keyof GraphOptions)[] = [
  "shape", "kind", "xyStyle", "groupLayout", "bars", "showPoints", "fill",
  "pointShape", "pointSize", "pointOutline", "pointOutlineColor", "pointFill", "outline", "outlineColor", "barGap",
  "lineWidth", "lineDash", "errorWidth", "errorCaps", "errorColor", "errorDirection",
  "survivalShowCensors", "pieShowPercent", "heatmapShowValues", "heatmapShowScale", "volcanoLabelCount",
];

// This Mac's preferences, never the project's: which sections are open, and the
// format and resolution of the last export.
const OPEN_KEY = "helix.graph.openSections";
function readOpen(): Set<string> {
  try {
    const saved = localStorage.getItem(OPEN_KEY);
    return new Set(saved ? (JSON.parse(saved) as string[]) : ["Statistics"]);
  } catch {
    return new Set(["Statistics"]);
  }
}

const EXPORT_KEY = "helix.graph.export";
type ExportChoice = { format: ExportFormat; dpi: Resolution };
function readExport(): ExportChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? "{}");
    return {
      format: EXPORT_FORMATS.some((f) => f.value === saved.format) ? saved.format : "png",
      dpi: RESOLUTIONS.includes(saved.dpi) ? saved.dpi : "300",
    };
  } catch {
    return { format: "png", dpi: "300" };
  }
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered; still works
  }
}

export function FormatPanel(props: Props) {
  const { graphType, options, set, seriesNames, setSeriesStyle, selection, autoX, autoY } = props;
  const family = GRAPHS[graphType].family;
  const hasAxes = family !== "pie";
  const [exported, setExported] = React.useState(readExport);
  const chooseExport = (choice: Partial<ExportChoice>) => {
    const next = { ...exported, ...choice };
    setExported(next);
    remember(EXPORT_KEY, next);
  };

  const [open, setOpen] = React.useState(readOpen);
  const fold = (title: string) => ({
    collapsed: !open.has(title),
    onToggle: () => {
      const next = new Set(open);
      if (!next.delete(title)) next.add(title);
      setOpen(next);
      remember(OPEN_KEY, [...next]);
    },
  });

  // A section's Reset, shown once one of its settings differs from what a new graph
  // of this type starts with.
  const fresh = newGraphOptions(graphType);
  const reset = (keys: (keyof GraphOptions)[]) =>
    keys.some((k) => options[k] !== fresh[k]) && (
      <Button variant="ghost" size="small" onClick={() => set(Object.fromEntries(keys.map((k) => [k, fresh[k]])))}>
        Reset
      </Button>
    );

  const palette = paletteOf(options);
  // What each series offers besides its color, while the graph draws it: its points'
  // shape, its line's dashes (a Mean & error line is one gray connector, not a series'),
  // the pattern over its fill.
  const module = GRAPHS[graphType];
  const offer = {
    shape: module.points?.(options),
    dash: module.lines?.(options) && family !== "column",
    pattern: module.patterns?.(options),
  };
  const statistics = statisticsControls(props);
  const data = dataControls(props);
  const style = styleControls(props);

  return (
    <>
      {statistics && (
        <Section title="Statistics" icon={<SigmaIcon />} {...fold("Statistics")}>
          {statistics}
        </Section>
      )}

      {data && (
        <Section title="Data" icon={<ChartBarIcon />} {...fold("Data")}>
          {data}
        </Section>
      )}

      {style && (
        <Section title="Style" icon={<PaintBrushIcon />} {...fold("Style")} action={reset(STYLE_OPTIONS)}>
          {style}
        </Section>
      )}

      {(seriesNames.length > 0 || family === "heatmap") && (
        <Section title="Series" icon={<PaletteIcon />} {...fold("Series")} action={reset(["series"])}>
          {/* A new palette drops the colors picked by hand, not the rest of their style. */}
          <PaletteRow
            value={palette}
            gradients={family === "heatmap"}
            onChange={(p) => set({ palette: savedPalette(p), series: withoutColors(options.series) })}
            onReverse={() => set({ palette: reversedPalette(palette), series: withoutColors(options.series) })}
          />
          {seriesNames.length > 0 && <SeriesHeader offer={offer} />}
          {seriesNames.map((name, i) => {
            const own = options.series?.[name];
            return (
              <SeriesRow
                key={name}
                label={family === "volcano" ? VOLCANO_SERIES[name] : name}
                palette={palette}
                style={{
                  color: own?.color ?? paletteColor(palette, i, seriesNames.length),
                  shape: own?.shape ?? options.pointShape,
                  dash: own?.dash ?? options.lineDash,
                  pattern: own?.pattern,
                }}
                offer={offer}
                onChange={(style) => setSeriesStyle(name, style)}
              />
            );
          })}
        </Section>
      )}

      {selection && (
        <Section
          title={`Selected points (${selection.count})`}
          icon={<CursorClickIcon />}
          {...fold("Selected points")}
          action={
            selection.styled && (
              <Button variant="ghost" size="small" onClick={selection.reset}>
                Reset
              </Button>
            )
          }
        >
          {/* The same controls as for every point (Style) and each series (Series). */}
          <SeriesHeader offer={{ shape: true }} />
          <SeriesRow
            label="Mark"
            palette={palette}
            style={{ ...selection.style, dash: options.lineDash }}
            offer={{ shape: true }}
            onChange={({ color, shape }) => selection.set(color ? { color } : { shape })}
          />
          <Stepper
            label="Size"
            value={selection.style.size}
            min={POINT_SIZE.min}
            max={POINT_SIZE.max}
            step={1}
            onChange={(size) => selection.resize(size - selection.style.size)}
          />
          <PercentRow label="Fill" value={selection.style.fill} onChange={(fill) => selection.set({ fill })} />
          <OutlineRows
            palette={palette}
            width={selection.style.outline}
            color={selection.style.outlineColor}
            onWidth={(outline) => selection.set({ outline })}
            onColor={(outlineColor, outline) => selection.set({ outlineColor, ...(outline && { outline }) })}
          />
          <Toggle label="Show label" checked={selection.style.label} onChange={(label) => selection.set({ label: label || undefined })} />
        </Section>
      )}

      <Section
        title="Text"
        icon={<TextTIcon />}
        {...fold("Text")}
        action={reset(["fontSize", "xTitleGap", "yTitleGap", "legend", "note"])}
      >
        <TextRow label="Title" value={options.title} onChange={(title) => set({ title })} />
        {hasAxes && (
          <>
            <TextRow label="X axis title" value={options.xLabel} onChange={(xLabel) => set({ xLabel })} />
            <TextRow label="Y axis title" value={options.yLabel} onChange={(yLabel) => set({ yLabel })} />
            <Stepper label="X title spacing" value={options.xTitleGap} min={0} max={40} step={2} onChange={(xTitleGap) => set({ xTitleGap })} />
            <Stepper label="Y title spacing" value={options.yTitleGap} min={0} max={40} step={2} onChange={(yTitleGap) => set({ yTitleGap })} />
          </>
        )}
        <Stepper
          label="Font size"
          value={options.fontSize}
          min={8}
          max={28}
          step={1}
          onChange={(fontSize) => set({ fontSize })}
        />
      </Section>

      {hasAxes && (
        <Section
          title="Axes"
          icon={<RulerIcon />}
          {...fold("Axes")}
          action={reset(["yMin", "yMax", "yStep", "xMin", "xMax", "xStep", "axisWidth"])}
        >
          {family !== "heatmap" && (
            <AxisRange
              axis="Y"
              min={options.yMin}
              max={options.yMax}
              step={options.yStep}
              auto={autoY}
              onChange={(yMin, yMax, yStep) => set({ yMin, yMax, yStep })}
            />
          )}
          {(family === "xy" || family === "volcano") && (
            <AxisRange
              axis="X"
              min={options.xMin}
              max={options.xMax}
              step={options.xStep}
              auto={autoX}
              onChange={(xMin, xMax, xStep) => set({ xMin, xMax, xStep })}
            />
          )}
          <ThicknessRow label="Axis thickness" value={options.axisWidth} onChange={(axisWidth) => set({ axisWidth })} />
        </Section>
      )}

      <Section title="Export" icon={<ExportIcon />} {...fold("Export")} action={reset(["width", "height", "background"])}>
        <SizeRow width={options.width} height={options.height} limits={GRAPH_SIZE} onChange={set} />
        <Choice
          label="Background"
          value={options.background}
          onChange={(background) => set({ background })}
          items={[
            { value: "white", label: "White" },
            { value: "transparent", label: "Transparent" },
          ]}
        />
        <Choice label="Format" value={exported.format} onChange={(format) => chooseExport({ format })} items={EXPORT_FORMATS} />
        {exported.format !== "svg" && (
          <Choice
            label="Resolution (dpi)"
            value={exported.dpi}
            onChange={(dpi) => chooseExport({ dpi })}
            items={RESOLUTIONS.map((dpi) => ({ value: dpi, label: dpi }))}
          />
        )}
        <div className="flex gap-2">
          <Button
            variant="accent"
            className="flex-1"
            disabled={!props.canExport}
            onClick={() => props.onSave(exported.format, exported.dpi)}
          >
            Save…
          </Button>
          <Button className="flex-1" disabled={!props.canExport} onClick={() => props.onCopy(exported.dpi)}>
            Copy
          </Button>
        </div>
      </Section>
    </>
  );
}

/** One axis's Min / Max / Step; a blank field is Auto and shows Plotly's value. */
function AxisRange({
  axis,
  min,
  max,
  step,
  auto,
  onChange,
}: {
  axis: "X" | "Y";
  min?: number;
  max?: number;
  step?: number;
  auto: Range;
  onChange: (min?: number, max?: number, step?: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumRow label={`${axis} min`} value={min} autoValue={auto?.min} onChange={(v) => onChange(v, max, step)} />
      <NumRow label={`${axis} max`} value={max} autoValue={auto?.max} onChange={(v) => onChange(min, v, step)} />
      <NumRow label={`${axis} step`} value={step} autoValue={auto?.step} onChange={(v) => onChange(min, max, v)} />
    </div>
  );
}
