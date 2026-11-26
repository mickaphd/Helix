// A graph's Format panel. Every graph has the same sections in the same order:
// Statistics · Data · Style · Series · Selected points · Text · Axes · Export. A
// section with nothing for this graph (or no point selected) is left out, the others
// never move. Which sections are open is one
// app-wide preference, kept across graphs and launches; Statistics starts open.
import * as React from "react";
import {
  ChartBarIcon,
  CursorClickIcon,
  ExportIcon,
  PaintBrushIcon,
  PaletteIcon,
  RulerIcon,
  SigmaIcon,
  TextTIcon,
} from "@phosphor-icons/react";
import { Button, Select } from "../../ui/controls";
import { titleCase } from "../../lib/format";
import { Row, Section, Stepper } from "../../components/inspector";
import { paletteColor, paletteOf, reversedPalette, savedPalette, withoutColors } from "../../lib/palettes";
import {
  GRAPH_LIMITS,
  MAX_REF_LINES,
  REF_LABEL_PLACES,
  SAME_AS_FILL,
  type GraphOptions,
  type GraphPalette,
  type PointStyle,
  type RefLine,
  type SeriesStyle,
} from "../../store/types";
import { GRAPHS, hasValueAxis, newGraphOptions, type AxisKind } from ".";
import { EXPORT_FORMATS, RESOLUTIONS, type ExportFormat, type Resolution } from "./graph-export";
import {
  Choice,
  ColorRow,
  DashRow,
  Group,
  NumRow,
  OutlineRows,
  PercentRow,
  PaletteRow,
  SeriesHeader,
  SeriesRow,
  SizeRow,
  TextRow,
  ThicknessRow,
  Toggle,
} from "./panel-controls";
import { dataControls, statisticsControls, styleControls, type SectionContext } from "./format-sections";
import { VOLCANO_SERIES } from "./volcano";
import { MatchSection } from "./match-graph";
import { useLayout } from "../../store/use-layout";

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
  graphId: string;
  setSeriesStyle: (key: string, style: SeriesStyle) => void;
  selection?: Selection;
  canExport: boolean;
  onSave: (format: ExportFormat, dpi: Resolution) => void;
  onCopy: (dpi: Resolution) => void;
  /** The table's series, in order: each shown one takes its place's color. */
  allSeries: string[];
  /** Where a new reference line goes: the middle of the value axis as drawn. */
  newLineAt: number;
}

// What the Style section sets, put back by its Reset.
const STYLE_OPTIONS: (keyof GraphOptions)[] = [
  "shape",
  "kind",
  "whiskers",
  "xyStyle",
  "residualsAs",
  "groupLayout",
  "bars",
  "showPoints",
  "fill",
  "pointShape",
  "pointSize",
  "pointOutline",
  "pointOutlineColor",
  "pointFill",
  "outline",
  "outlineColor",
  "barGap",
  "lineWidth",
  "lineDash",
  "errorWidth",
  "errorCaps",
  "errorColor",
  "errorDirection",
  "survivalShowCensors",
  "survivalShowBand",
  "survivalAtRisk",
  "pieShowPercent",
  "heatmapShowValues",
  "heatmapShowScale",
  "volcanoLabelCount",
];

/** The sections, in their one order (each shown only when it has something for the graph). */
export const SECTIONS = ["Statistics", "Data", "Style", "Series", "Selected points", "Text", "Axes", "Match", "Export"];

// This Mac's preference, never the project's: the format and resolution of the last export.
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
  const { graphType, options, set, seriesNames, setSeriesStyle, selection } = props;
  const { family, horizontal, placesRows } = GRAPHS[graphType];
  const axes = GRAPHS[graphType].axes(options, props.atValues);
  const hasAxes = !!(axes.x || axes.y);
  // The keys of an axis as shown: horizontal bars keep their value axis's in y, their rows' in x.
  const keyOf = (shown: "X" | "Y") => ((shown === "X") === !horizontal ? "x" : "y");
  const [exported, setExported] = React.useState(readExport);
  const chooseExport = (choice: Partial<ExportChoice>) => {
    const next = { ...exported, ...choice };
    setExported(next);
    remember(EXPORT_KEY, next);
  };

  // A section folds or unfolds by its title; with ⌥, every section does the same.
  const { openSections: open, setOpenSections } = useLayout();
  const fold = (title: string) => ({
    collapsed: !open.has(title),
    onToggle: (all: boolean) => {
      const opening = !open.has(title);
      const next = new Set(open);
      for (const t of all ? SECTIONS : [title]) {
        if (opening) next.add(t);
        else next.delete(t);
      }
      setOpenSections(next);
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
          {seriesNames.map((name) => {
            const own = options.series?.[name];
            return (
              <SeriesRow
                key={name}
                label={family === "volcano" ? VOLCANO_SERIES[name] : name}
                palette={palette}
                style={{
                  // Its color is its place's among the table's series (`allSeries`).
                  color:
                    own?.color ??
                    paletteColor(palette, Math.max(0, props.allSeries.indexOf(name)), props.allSeries.length),
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
            {...GRAPH_LIMITS.pointSize}
            step={1}
            onChange={(size) => selection.resize(size - selection.style.size)}
          />
          <PercentRow
            label="Fill"
            value={selection.style.fill}
            limits={GRAPH_LIMITS.pointFill}
            onChange={(fill) => selection.set({ fill })}
          />
          <OutlineRows
            palette={palette}
            width={selection.style.outline}
            limits={GRAPH_LIMITS.pointOutline}
            color={selection.style.outlineColor}
            onWidth={(outline) => selection.set({ outline })}
            onColor={(outlineColor, outline) => selection.set({ outlineColor, ...(outline && { outline }) })}
          />
          <Toggle
            label="Show label"
            checked={selection.style.label}
            onChange={(label) => selection.set({ label: label || undefined })}
          />
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
            {(["X", "Y"] as const).map((shown) => (
              <TextRow
                key={shown}
                label={`${shown} axis title`}
                value={options[`${keyOf(shown)}Label`]}
                onChange={(label) => set({ [`${keyOf(shown)}Label`]: label })}
              />
            ))}
            {(["X", "Y"] as const).map((shown) => (
              <Stepper
                key={shown}
                label={`${shown} title spacing`}
                value={options[`${keyOf(shown)}TitleGap`]}
                {...GRAPH_LIMITS[`${keyOf(shown)}TitleGap`]}
                step={2}
                onChange={(gap) => set({ [`${keyOf(shown)}TitleGap`]: gap })}
              />
            ))}
          </>
        )}
        <Stepper
          label="Font size"
          value={options.fontSize}
          {...GRAPH_LIMITS.fontSize}
          step={1}
          onChange={(fontSize) => set({ fontSize })}
        />
      </Section>

      {hasAxes && (
        <Section
          title="Axes"
          icon={<RulerIcon />}
          {...fold("Axes")}
          action={reset([
            "yMin",
            "yMax",
            "yStep",
            "xMin",
            "xMax",
            "xStep",
            "xScale",
            "yScale",
            "axisWidth",
            "refLines",
          ])}
        >
          {(["Y", "X"] as const).map((shown) => (
            <React.Fragment key={shown}>
              {shown === "X" && placesRows && props.atValues && (
                <Choice
                  label="X axis"
                  value={options.rowsAt}
                  onChange={(rowsAt) => set({ rowsAt })}
                  items={[
                    { value: "order", label: "Categories" },
                    { value: "values", label: "Numbers" },
                  ]}
                />
              )}
              <AxisRows
                shown={shown}
                kind={axes[shown === "X" ? "x" : "y"]}
                k={keyOf(shown)}
                options={options}
                set={set}
                leftOut={props.logLeftOut[keyOf(shown)]}
              />
            </React.Fragment>
          ))}
          <ThicknessRow
            label="Axis thickness"
            value={options.axisWidth}
            limits={GRAPH_LIMITS.axisWidth}
            onChange={(axisWidth) => set({ axisWidth })}
          />
          {hasValueAxis(family) && (
            <RefLines
              lines={options.refLines ?? []}
              axis={horizontal ? "X" : "Y"}
              at={props.newLineAt}
              palette={paletteOf(options)}
              onChange={(lines) => set({ refLines: lines.length ? lines : undefined })}
            />
          )}
        </Section>
      )}

      <MatchSection key={props.graphId} graphId={props.graphId} set={set} {...fold("Match")} />

      <Section
        title="Export"
        icon={<ExportIcon />}
        {...fold("Export")}
        action={reset(["width", "height", "background"])}
      >
        <SizeRow width={options.width} height={options.height} onChange={set} />
        <Choice
          label="Background"
          value={options.background}
          onChange={(background) => set({ background })}
          items={[
            { value: "white", label: "White" },
            { value: "transparent", label: "Transparent" },
          ]}
        />
        <Choice
          label="Format"
          value={exported.format}
          onChange={(format) => chooseExport({ format })}
          items={EXPORT_FORMATS}
        />
        {exported.format !== "svg" && (
          <Choice
            label="Resolution (DPI)"
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

/** One axis's settings, as its graph applies them (`kind`), kept in its keys (`k`): its scale
 *  and range, or its range alone. An axis of categories has none: its labels are its
 *  columns' or rows' names, all shown, spaced only where they would overlap. */
function AxisRows({
  shown,
  kind,
  k,
  options,
  set,
  leftOut,
}: {
  shown: "X" | "Y";
  kind?: AxisKind;
  k: "x" | "y";
  options: GraphOptions;
  set: (patch: Partial<GraphOptions>) => void;
  leftOut: number;
}) {
  if (!kind || kind === "labels") return null;
  const scale = options[`${k}Scale`];
  return (
    <>
      {kind === "scale" && (
        <Scale axis={shown} value={scale} leftOut={leftOut} onChange={(s) => set({ [`${k}Scale`]: s })} />
      )}
      <AxisRange
        axis={shown}
        min={options[`${k}Min`]}
        max={options[`${k}Max`]}
        step={options[`${k}Step`]}
        log={kind === "scale" && scale !== "linear"}
        onChange={(min, max, step) => set({ [`${k}Min`]: min, [`${k}Max`]: max, [`${k}Step`]: step })}
      />
    </>
  );
}

/** An axis's Min / Max / Step, a blank field Auto; a log axis has no step (its ticks are
 *  the powers). */
function AxisRange({
  axis,
  min,
  max,
  step,
  log,
  onChange,
}: {
  axis: "X" | "Y";
  min?: number;
  max?: number;
  step?: number;
  log: boolean;
  onChange: (min?: number, max?: number, step?: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumRow label={`${axis} min`} value={min} onChange={(v) => onChange(v, max, step)} />
      <NumRow label={`${axis} max`} value={max} onChange={(v) => onChange(min, v, step)} />
      {!log && <NumRow label={`${axis} step`} value={step} onChange={(v) => onChange(min, max, v)} />}
    </div>
  );
}

/** The reference lines across the plot: for each, where (on the value axis, `axis`), its
 *  text, dashes, thickness and color (none: the axes'); added at `at`, removed one by one. */
function RefLines({
  lines,
  axis,
  at,
  palette,
  onChange,
}: {
  lines: RefLine[];
  axis: "X" | "Y";
  at: number;
  palette: GraphPalette;
  onChange: (lines: RefLine[]) => void;
}) {
  const change = (i: number, line: Partial<RefLine>) =>
    onChange(lines.map((l, k) => (k === i ? { ...l, ...line } : l)));
  return (
    <>
      {lines.map((l, i) => (
        <Group key={i} title={lines.length > 1 ? `Reference line ${i + 1}` : "Reference line"}>
          <NumRow
            label={`At ${axis}`}
            value={l.value}
            required
            onChange={(value) => value !== undefined && change(i, { value })}
          />
          <TextRow label="Text" value={l.label ?? ""} onChange={(label) => change(i, { label: label || undefined })} />
          {l.label && (
            <Row label="Text place">
              <Select
                value={l.labelPlace ?? "top-right"}
                onChange={(labelPlace) => change(i, { labelPlace })}
                options={REF_LABEL_PLACES.map((p) => ({ value: p, label: titleCase(p.replace("-", " ")) }))}
              />
            </Row>
          )}
          <DashRow value={l.dash} onChange={(dash) => change(i, { dash })} />
          <ThicknessRow
            label="Thickness"
            value={l.width}
            limits={GRAPH_LIMITS.lineWidth}
            onChange={(width) => change(i, { width })}
          />
          <ColorRow
            label="Color"
            palette={palette}
            color={l.color}
            same="Same as Axes"
            onChange={(color) => change(i, { color: color === SAME_AS_FILL ? undefined : color })}
          />
          <Button onClick={() => onChange(lines.filter((_, k) => k !== i))}>Remove Line</Button>
        </Group>
      ))}
      {lines.length < MAX_REF_LINES && (
        <Button onClick={() => onChange([...lines, { value: at, dash: "dash", width: 1 }])}>Add Reference Line</Button>
      )}
    </>
  );
}

/** An axis's scale, and how many values a log scale can't show. */
function Scale({
  axis,
  value,
  leftOut,
  onChange,
}: {
  axis: "X" | "Y";
  value: GraphOptions["xScale"];
  leftOut: number;
  onChange: (scale: GraphOptions["xScale"]) => void;
}) {
  return (
    <>
      <Choice
        label={`${axis} scale`}
        value={value}
        onChange={onChange}
        items={[
          { value: "linear", label: "Linear" },
          { value: "log10", label: "Log10" },
          { value: "log2", label: "Log2" },
        ]}
      />
      {value !== "linear" && leftOut > 0 && (
        <p className="text-small text-secondary">
          {leftOut} {leftOut === 1 ? "value" : "values"} at or under 0 can't be drawn on a log axis.
        </p>
      )}
    </>
  );
}
