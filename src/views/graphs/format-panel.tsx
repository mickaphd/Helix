// A graph's Format panel. Every graph has the same sections in the same order:
// Statistics · Data · Style · Colors · Text · Axes · Export. A section with nothing
// for this graph is left out, the others never move. Which sections are open is one
// app-wide preference, kept across graphs and launches; Statistics starts open.
import * as React from "react";
import { Button } from "../../ui/controls";
import { Section } from "../../components/common/inspector";
import { resolveColor } from "../../lib/palette";
import { DEFAULT_GRAPH_OPTIONS, type GraphOptions, type PaletteColor } from "../../store/types";
import { GRAPHS } from ".";
import { EXPORT_FORMATS, type ExportFormat } from "./graph-export";
import { GRAPH_SIZE } from "./plot-helpers";
import { Choice, ColorRow, NumRow, SizeRow, Stepper, TextRow } from "./panel-controls";
import { dataControls, statisticsControls, styleControls, type SectionContext } from "./format-sections";

type Range = { min: number; max: number; step: number } | null;

interface Props extends SectionContext {
  seriesColors?: Record<string, PaletteColor>;
  setSeriesColor: (key: string, color: PaletteColor | undefined) => void;
  /** Plotly's own axis ranges, shown while Min/Max/Step are on Auto. */
  autoX: Range;
  autoY: Range;
  canExport: boolean;
  onSave: (format: ExportFormat) => void;
  onCopy: () => void;
}

const OPEN_KEY = "helix.graph.openSections";
function readOpen(): Set<string> {
  try {
    const saved = localStorage.getItem(OPEN_KEY);
    return new Set(saved ? (JSON.parse(saved) as string[]) : ["Statistics"]);
  } catch {
    return new Set(["Statistics"]);
  }
}

export function FormatPanel(props: Props) {
  const { graphType, options, set, seriesNames, seriesColors, setSeriesColor, autoX, autoY } = props;
  const family = GRAPHS[graphType].family;
  const hasAxes = family !== "pie";
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>("png");

  const [open, setOpen] = React.useState(readOpen);
  const fold = (title: string) => ({
    collapsed: !open.has(title),
    onToggle: () => {
      const next = new Set(open);
      if (!next.delete(title)) next.add(title);
      setOpen(next);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // not remembered; still works
      }
    },
  });

  // A section's Reset, shown once one of its settings differs from the default.
  const reset = (keys: (keyof GraphOptions)[]) =>
    keys.some((k) => options[k] !== DEFAULT_GRAPH_OPTIONS[k]) && (
      <Button
        variant="ghost"
        size="small"
        onClick={() => set(Object.fromEntries(keys.map((k) => [k, DEFAULT_GRAPH_OPTIONS[k]])))}
      >
        Reset
      </Button>
    );

  const statistics = statisticsControls(props);
  const data = dataControls(props);
  const style = styleControls(props);

  return (
    <>
      {statistics && (
        <Section title="Statistics" {...fold("Statistics")}>
          {statistics}
        </Section>
      )}

      {data && (
        <Section title="Data" {...fold("Data")}>
          {data}
        </Section>
      )}

      {style && (
        <Section title="Style" {...fold("Style")}>
          {style}
        </Section>
      )}

      {seriesNames.length > 0 && (
        <Section title="Colors" {...fold("Colors")}>
          {seriesNames.map((name, i) => (
            <ColorRow
              key={name}
              label={name}
              value={resolveColor(seriesColors, name, i)}
              onChange={(token) => setSeriesColor(name, token)}
            />
          ))}
        </Section>
      )}
      {family === "volcano" && (
        <Section title="Colors" {...fold("Colors")}>
          <ColorRow
            label="Up-regulated"
            value={options.volcanoColorUp}
            onChange={(token) => set({ volcanoColorUp: token ?? "red" })}
          />
          <ColorRow
            label="Down-regulated"
            value={options.volcanoColorDown}
            onChange={(token) => set({ volcanoColorDown: token ?? "blue" })}
          />
        </Section>
      )}

      <Section title="Text" {...fold("Text")} action={reset(["fontSize"])}>
        <TextRow label="Title" value={options.title} onChange={(title) => set({ title })} />
        {hasAxes && (
          <>
            <TextRow label="X axis title" value={options.xLabel} onChange={(xLabel) => set({ xLabel })} />
            <TextRow label="Y axis title" value={options.yLabel} onChange={(yLabel) => set({ yLabel })} />
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
          <Stepper
            label="Axis thickness"
            value={options.axisWidth}
            min={0.5}
            max={6}
            step={0.5}
            onChange={(axisWidth) => set({ axisWidth })}
          />
        </Section>
      )}

      <Section title="Export" {...fold("Export")}>
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
        <Choice label="Format" value={exportFormat} onChange={setExportFormat} items={EXPORT_FORMATS} />
        <div className="flex gap-2">
          <Button
            variant="accent"
            className="flex-1"
            disabled={!props.canExport}
            onClick={() => props.onSave(exportFormat)}
          >
            Save…
          </Button>
          <Button className="flex-1" disabled={!props.canExport} onClick={props.onCopy}>
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
