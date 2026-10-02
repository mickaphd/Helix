// What the Statistics, Data and Style sections of the Format panel hold for each
// graph (the other sections are the same for every graph, see format-panel.tsx).
// Each returns null when it has nothing for this graph, and the section is left out.
import * as React from "react";
import { Button, Checkbox, Input, Select, cn } from "../../ui/controls";
import { Row } from "../../components/common/inspector";
import type { AnalysisType } from "../../stats/types";
import { SAME_AS_FILL, type GraphOptions, type GraphType, type ProjectNode, type TableType } from "../../store/types";
import { isSignificant, pStars } from "../../lib/format";
import { GRAPHS } from ".";
import type { SigComparison } from "./significance-overlay";
import { POINT_SIZE } from "./plot-helpers";
import { paletteOf } from "../../lib/palettes";
import {
  Choice,
  ColorRow,
  ColumnSelectRow,
  DashRow,
  Group,
  NumRow,
  OutlineRows,
  PercentRow,
  ShapeRow,
  Stepper,
  ThicknessRow,
  Toggle,
  type SetOptions,
} from "./panel-controls";

export interface SectionContext {
  graphType: GraphType;
  tableType?: TableType;
  options: GraphOptions;
  set: SetOptions;
  /** The analyses of the graph's table: sources for significance stars and fitted lines. */
  analyses: ProjectNode[];
  comparisons: SigComparison[];
  seriesNames: string[];
  /** Volcano on a grouped table: the groups it can compare (Helix computes the DEGs). */
  volcanoGroups?: string[];
  numericNames: string[];
  allNames: string[];
  doseError: string | null;
  onNewAnalysis: () => void;
  /** Volcano: selects the genes named (comma-separated); returns the names no gene has. */
  onFindGenes: (query: string) => string[];
}

// The analyses whose results name pairs of columns with a P value.
const SIGNIFICANCE_SOURCES = new Set<AnalysisType | undefined>([
  "compare-two-groups",
  "anova",
  "kruskal-wallis",
  "rm-anova",
  "friedman",
]);

const CENTER_ITEMS = [
  { value: "mean" as const, label: "Mean" },
  { value: "median" as const, label: "Median" },
];
// The graphs that draw a center with error bars; Individual values and Interleaved
// scatter draw it as a short line, styled with them.
const WITH_ERROR_BARS = new Set<GraphType>(["individual", "mean-error", "grouped-bars", "grouped-hbars", "grouped-scatter", "grouped-lines"]);
const WITH_CENTER_LINE = new Set<GraphType>(["individual", "grouped-scatter"]);

const ERROR_ITEMS = [
  { value: "none" as const, label: "None" },
  { value: "sd" as const, label: "SD" },
  { value: "sem" as const, label: "SEM" },
];

// ── Statistics: what's computed and drawn on the graph ──────────────────

export function statisticsControls(c: SectionContext): React.ReactNode {
  const { graphType, options, set } = c;
  if (GRAPHS[graphType].family === "column") {
    const sources = c.analyses.filter((a) => SIGNIFICANCE_SOURCES.has(a.analysisType));
    if (!sources.length) {
      return (
        <NoAnalysis onNewAnalysis={c.onNewAnalysis}>
          Show significance stars from a t test, or from an ANOVA or Kruskal-Wallis test with
          multiple comparisons, of this table.
        </NoAnalysis>
      );
    }
    return <SignificanceControls analyses={sources} comparisons={c.comparisons} options={options} set={set} />;
  }
  if (graphType === "xy-scatter") {
    const sources = c.analyses.filter((a) => a.analysisType === "linear-regression");
    if (!sources.length) {
      return (
        <NoAnalysis onNewAnalysis={c.onNewAnalysis}>
          Draw the fitted line of a linear regression of this table.
        </NoAnalysis>
      );
    }
    return <RegressionControls analyses={sources} options={options} set={set} />;
  }
  if (graphType === "dose-response") {
    return (
      <>
        <Choice
          label="Model"
          value={options.doseModel}
          onChange={(doseModel) => set({ doseModel })}
          items={[
            { value: "sigmoidal-4pl-logx", label: "Log X" },
            { value: "sigmoidal-4pl-x", label: "Linear X" },
          ]}
        />
        <Toggle
          label="Fitted curve"
          checked={options.doseShowCurve}
          onChange={(doseShowCurve) => set({ doseShowCurve })}
        />
        <Toggle
          label="EC50 & Hill slope"
          checked={options.doseShowEquation}
          onChange={(doseShowEquation) => set({ doseShowEquation })}
        />
        {c.doseError && <p className="text-small text-secondary">{c.doseError}</p>}
      </>
    );
  }
  if (graphType === "volcano") {
    // Cutoffs are entered on the plotted scale (e.g. 1.3 when Y is −log10).
    const sig = c.volcanoGroups && options.volcanoSignificance === "fdr" ? "FDR" : "P";
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <NumRow
            label="Fold change"
            value={options.volcanoFcThreshold}
            onChange={(v) => set({ volcanoFcThreshold: v ?? 0 })}
          />
          <NumRow
            label={options.volcanoYIsPValue ? `−log10 ${sig}` : sig}
            value={options.volcanoPThreshold}
            onChange={(v) => set({ volcanoPThreshold: v ?? 0 })}
          />
        </div>
        <Toggle
          label="Threshold lines"
          checked={options.volcanoShowThresholds}
          onChange={(volcanoShowThresholds) => set({ volcanoShowThresholds })}
        />
      </>
    );
  }
  return null;
}

/** A graph whose statistics come from an analysis the table doesn't have yet. */
function NoAnalysis({ onNewAnalysis, children }: { onNewAnalysis: () => void; children: React.ReactNode }) {
  return (
    <>
      <p className="text-small text-secondary">{children}</p>
      <Button className="self-start" onClick={onNewAnalysis}>
        New Analysis…
      </Button>
    </>
  );
}

/** Pick an analysis, then which of its pairwise comparisons get a bracket. */
function SignificanceControls({
  analyses,
  comparisons,
  options,
  set,
}: {
  analyses: ProjectNode[];
  comparisons: SigComparison[];
  options: GraphOptions;
  set: SetOptions;
}) {
  const selected = options.sigPairs ?? [];
  const togglePair = (key: string, on: boolean) =>
    set({ sigPairs: on ? [...selected, key] : selected.filter((k) => k !== key) });

  return (
    <>
      <Row label="Analysis">
        <Select
          value={options.sigAnalysisId ?? ""}
          onChange={(v) => set({ sigAnalysisId: v || undefined, sigPairs: [] })}
          placeholder="None"
          options={analyses.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Row>

      {options.sigAnalysisId ? (
        <>
          <Choice
            label="Show"
            value={options.sigDisplay}
            onChange={(sigDisplay) => set({ sigDisplay })}
            items={[
              { value: "stars", label: "Stars" },
              { value: "pvalue", label: "P value" },
            ]}
          />
          {comparisons.length ? (
            <Row label="Comparisons">
              <div className="flex flex-col gap-1.5">
                {comparisons.map((c) => (
                  <label key={c.key} className="flex items-center gap-2">
                    <Checkbox checked={selected.includes(c.key)} onChange={(checked) => togglePair(c.key, checked)} />
                    <span className="flex-1 truncate text-small">
                      {c.group1} vs {c.group2}
                    </span>
                    <span
                      className={cn("text-small tabular-nums", isSignificant(c.p) ? "text-support-green" : "text-secondary")}
                    >
                      {pStars(c.p)}
                    </span>
                  </label>
                ))}
              </div>
            </Row>
          ) : (
            <p className="text-small text-secondary">
              This analysis has no pairwise comparisons. Use a two-group test, or an ANOVA /
              Kruskal-Wallis with multiple comparisons.
            </p>
          )}
        </>
      ) : null}
    </>
  );
}

/** Pick a linear regression, then which parts of its fit to draw. */
function RegressionControls({
  analyses,
  options,
  set,
}: {
  analyses: ProjectNode[];
  options: GraphOptions;
  set: SetOptions;
}) {
  return (
    <>
      <Row label="Analysis">
        <Select
          value={options.regAnalysisId ?? ""}
          onChange={(v) => set({ regAnalysisId: v || undefined })}
          placeholder="None"
          options={analyses.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Row>
      {options.regAnalysisId ? (
        <>
          <Toggle label="Fit line" checked={options.regShowLine} onChange={(regShowLine) => set({ regShowLine })} />
          <Toggle label="95% CI band" checked={options.regShowBand} onChange={(regShowBand) => set({ regShowBand })} />
          <Toggle
            label="Equation & R²"
            checked={options.regShowEquation}
            onChange={(regShowEquation) => set({ regShowEquation })}
          />
        </>
      ) : null}
    </>
  );
}

// ── Data: what the graph shows of the table ─────────────────────────────

export function dataControls(c: SectionContext): React.ReactNode {
  const { graphType, options, set } = c;
  // A contingency table holds one count per cell: nothing to summarize.
  if (c.tableType === "contingency") return null;
  const center = (
    <Choice label="Center" value={options.center} onChange={(center) => set({ center })} items={CENTER_ITEMS} />
  );
  const error = (
    <Choice label="Error bars" value={options.error} onChange={(error) => set({ error })} items={ERROR_ITEMS} />
  );
  if (WITH_ERROR_BARS.has(graphType)) {
    return (
      <>
        {center}
        {error}
      </>
    );
  }
  switch (graphType) {
    case "grouped-stacked":
      return center; // stacked bars have no error bars
    case "pie":
    case "donut":
      return (
        <Choice
          label="Slice value"
          value={options.pieValue}
          onChange={(pieValue) => set({ pieValue })}
          items={[
            { value: "sum", label: "Sum" },
            { value: "mean", label: "Mean" },
          ]}
        />
      );
    case "survival":
      return (
        <Choice
          label="Data format"
          value={options.survivalMode}
          onChange={(survivalMode) => set({ survivalMode })}
          items={[
            { value: "codes", label: "Event codes" },
            { value: "counts", label: "Survivor counts" },
          ]}
        />
      );
    case "dose-response":
      return c.seriesNames.length > 1 ? (
        <Row label="Y data set">
          <Select
            value={options.doseY ?? c.seriesNames[0]}
            onChange={(doseY) => set({ doseY })}
            options={c.seriesNames.map((name) => ({ value: name, label: name }))}
          />
        </Row>
      ) : null;
    case "volcano":
      return (
        <>
          {c.volcanoGroups ? <GroupedVolcanoData groups={c.volcanoGroups} options={options} set={set} /> : (
            <FlatVolcanoData numericNames={c.numericNames} allNames={c.allNames} options={options} set={set} />
          )}
          <Toggle
            label="Y as −log10"
            checked={options.volcanoYIsPValue}
            onChange={(volcanoYIsPValue) => set({ volcanoYIsPValue })}
          />
          {/* Genes are found by name: a grouped table's row titles, else the label column. */}
          {(c.volcanoGroups || options.volcanoLabel) && <FindGenes find={c.onFindGenes} />}
        </>
      );
    default:
      return null;
  }
}

/** A volcano of a Multiple Variables table plots the columns the user already has:
 *  X = effect size (log2 fold change), Y = a P value, adjusted P or FDR. */
function FlatVolcanoData({
  numericNames,
  allNames,
  options,
  set,
}: {
  numericNames: string[];
  allNames: string[];
  options: GraphOptions;
  set: SetOptions;
}) {
  return (
    <>
      <ColumnSelectRow
        label="X — fold change"
        value={options.volcanoX ?? numericNames[0]}
        names={numericNames}
        onChange={(volcanoX) => set({ volcanoX })}
      />
      <ColumnSelectRow
        label="Y — significance"
        value={options.volcanoY ?? numericNames[1] ?? numericNames[0]}
        names={numericNames}
        onChange={(volcanoY) => set({ volcanoY })}
      />
      <ColumnSelectRow
        label="Gene labels from"
        value={options.volcanoLabel}
        names={allNames}
        allowNone
        onChange={(volcanoLabel) => set({ volcanoLabel })}
      />
    </>
  );
}

/** A volcano of a grouped table compares two of its groups row by row (Welch t test
 *  and BH FDR, see lib/deg.ts); gene labels are the row titles. */
function GroupedVolcanoData({ groups, options, set }: { groups: string[]; options: GraphOptions; set: SetOptions }) {
  // A saved group that no longer exists (renamed in the table) falls back to the first two.
  const groupA = groups.includes(options.volcanoGroupA ?? "") ? options.volcanoGroupA : groups[0];
  const groupB = groups.includes(options.volcanoGroupB ?? "") ? options.volcanoGroupB : groups[1];
  return (
    <>
      {groups.length < 2 && (
        <p className="text-small text-secondary">This table needs at least two groups to compute a volcano.</p>
      )}
      <ColumnSelectRow
        label="Group A (control)"
        value={groupA}
        names={groups}
        onChange={(volcanoGroupA) => set({ volcanoGroupA })}
      />
      <ColumnSelectRow
        label="Group B (treated)"
        value={groupB}
        names={groups}
        onChange={(volcanoGroupB) => set({ volcanoGroupB })}
      />
      <Choice
        label="Effect size (X)"
        value={options.volcanoEffect}
        onChange={(volcanoEffect) => set({ volcanoEffect })}
        items={[
          { value: "log2ratio", label: "log2 ratio" },
          { value: "difference", label: "Difference" },
        ]}
      />
      <Choice
        label="Significance (Y)"
        value={options.volcanoSignificance}
        onChange={(volcanoSignificance) => set({ volcanoSignificance })}
        items={[
          { value: "pvalue", label: "P value" },
          { value: "fdr", label: "FDR" },
        ]}
      />
    </>
  );
}

/** Selects the genes typed (names separated by commas, whole and in any case) when
 *  Return is pressed, and says which names no gene has. */
function FindGenes({ find }: { find: (query: string) => string[] }) {
  const [missing, setMissing] = React.useState<string[]>([]);
  return (
    <>
      <Row label="Find gene">
        <Input
          placeholder="Names, separated by commas"
          onKeyDown={(e) => e.key === "Enter" && setMissing(find(e.currentTarget.value))}
          onChange={() => setMissing([])}
        />
      </Row>
      {missing.length > 0 && <p className="text-small text-secondary">No gene named {missing.join(", ")}.</p>}
    </>
  );
}

// ── Style: how the marks look ───────────────────────────────────────────
// One group per thing drawn (Bars, Box, Points…, Lines, Error bars), each only while
// it is drawn, after the choice of how the graph is drawn (Draw as, Groups). Inside a
// group: whether it is shown, then its size or gap, fill, outline and outline color.

/** How the graph is drawn: what it alone draws, then its lines and error bars. */
export function styleControls(context: SectionContext): React.ReactNode {
  const own = ownStyle(context);
  const lines = linesGroup(context);
  const errors = errorsGroup(context);
  return own || lines || errors ? (
    <>
      {own}
      {lines}
      {errors}
    </>
  ) : null;
}

/** The fill and outline of a graph's shapes: bars, boxes, violins, areas, slices. */
function shapeRows({ options, set }: SectionContext) {
  return (
    <>
      <PercentRow label="Fill" value={options.fill} onChange={(fill) => set({ fill })} />
      <OutlineRows
        palette={paletteOf(options)}
        width={options.outline}
        color={options.outlineColor}
        onWidth={(outline) => set({ outline })}
        onColor={(color, outline = options.outline) => set({ outlineColor: color === SAME_AS_FILL ? undefined : color, outline })}
      />
    </>
  );
}

/** The Points group: whether they are shown (`toggle`), then every point's shape,
 *  size, fill and outline. */
function pointsGroup({ graphType, options, set }: SectionContext, toggle?: React.ReactNode) {
  return (
    <Group title="Points">
      {toggle}
      {GRAPHS[graphType].points?.(options) && (
        <>
          <ShapeRow value={options.pointShape} onChange={(pointShape) => set({ pointShape })} />
          <Stepper
            label="Size"
            value={options.pointSize}
            min={POINT_SIZE.min}
            max={POINT_SIZE.max}
            step={1}
            onChange={(pointSize) => set({ pointSize })}
          />
          <PercentRow label="Fill" value={options.pointFill} onChange={(pointFill) => set({ pointFill })} />
          <OutlineRows
            palette={paletteOf(options)}
            width={options.pointOutline}
            color={options.pointOutlineColor}
            onWidth={(pointOutline) => set({ pointOutline })}
            onColor={(color, pointOutline = options.pointOutline) =>
              set({ pointOutlineColor: color === SAME_AS_FILL ? undefined : color, pointOutline })
            }
          />
        </>
      )}
    </Group>
  );
}

/** Every series line's thickness and dashes (a survival curve's censored subjects with them). */
function linesGroup({ graphType, options, set }: SectionContext) {
  if (!GRAPHS[graphType].lines?.(options)) return null;
  return (
    <Group title="Lines">
      <ThicknessRow label="Thickness" value={options.lineWidth} onChange={(lineWidth) => set({ lineWidth })} />
      <DashRow value={options.lineDash} onChange={(lineDash) => set({ lineDash })} />
      {graphType === "survival" && options.survivalMode === "codes" && (
        <Toggle
          label="Show censored ticks"
          checked={options.survivalShowCensors}
          onChange={(survivalShowCensors) => set({ survivalShowCensors })}
        />
      )}
    </Group>
  );
}

/** Error bars (and the center line drawn with them): thickness, caps, color, and
 *  which way they go. */
function errorsGroup({ graphType, options, set }: SectionContext) {
  const bars = WITH_ERROR_BARS.has(graphType) && options.error !== "none";
  const line = WITH_CENTER_LINE.has(graphType);
  if (!bars && !line) return null;
  return (
    <Group title={!bars ? "Center line" : line ? "Center line and error bars" : "Error bars"}>
      <ThicknessRow label="Thickness" value={options.errorWidth} onChange={(errorWidth) => set({ errorWidth })} />
      {bars && <Stepper label="Caps" value={options.errorCaps} min={0} max={20} step={1} onChange={(errorCaps) => set({ errorCaps })} />}
      <ColorRow
        label="Color"
        palette={paletteOf(options)}
        color={options.errorColor}
        same="Same as Series"
        onChange={(color) => set({ errorColor: color === SAME_AS_FILL ? undefined : color })}
      />
      {bars && (
        <Choice
          label="Direction"
          value={options.errorDirection}
          onChange={(errorDirection) => set({ errorDirection })}
          items={[
            { value: "both", label: "Both" },
            { value: "above", label: graphType === "grouped-hbars" ? "Right" : "Above" },
          ]}
        />
      )}
    </Group>
  );
}

/** What this graph alone draws. */
function ownStyle(context: SectionContext): React.ReactNode {
  const { graphType, options, set } = context;
  const shapes = (title: string, first?: React.ReactNode) => (
    <Group title={title}>
      {first}
      {shapeRows(context)}
    </Group>
  );
  // A row's bars apart, while several stand side by side.
  const gap = <PercentRow label="Gap" value={options.barGap} max={0.5} onChange={(barGap) => set({ barGap })} />;
  const points = GRAPHS[graphType].points?.(options) && pointsGroup(context);
  switch (graphType) {
    case "individual":
      return (
        <>
          <Group title="Bars">
            <Toggle label="Show bars" checked={options.bars} onChange={(bars) => set({ bars })} />
            {options.bars && shapeRows(context)}
          </Group>
          {points}
        </>
      );
    case "mean-error":
      return (
        <>
          <Choice
            label="Draw as"
            value={options.shape}
            onChange={(shape) => set({ shape })}
            items={[
              { value: "bar", label: "Bars" },
              { value: "point", label: "Points" },
              { value: "line", label: "Line" },
            ]}
          />
          {options.shape === "bar" ? shapes("Bars") : points}
        </>
      );
    case "box-violin":
      return (
        <>
          <Choice
            label="Draw as"
            value={options.kind}
            onChange={(kind) => set({ kind })}
            items={[
              { value: "box", label: "Box" },
              { value: "violin", label: "Violin" },
            ]}
          />
          {shapes(options.kind === "violin" ? "Violin" : "Box")}
          {pointsGroup(context, <Toggle label="Show points" checked={options.showPoints} onChange={(showPoints) => set({ showPoints })} />)}
        </>
      );
    case "xy-scatter":
      return (
        <>
          <Choice
            label="Draw as"
            value={options.xyStyle}
            onChange={(xyStyle) => set({ xyStyle })}
            items={[
              { value: "points", label: "Points" },
              { value: "line", label: "Line" },
              { value: "points+line", label: "Both" },
            ]}
          />
          {points}
        </>
      );
    case "xy-bar":
      return shapes("Bars", context.seriesNames.length > 1 && gap);
    case "grouped-stacked":
      return shapes("Bars");
    case "xy-area":
      return shapes("Area");
    case "grouped-bars":
    case "grouped-hbars":
    case "grouped-scatter":
      return (
        <>
          <Choice
            label="Groups"
            value={options.groupLayout}
            onChange={(groupLayout) => set({ groupLayout })}
            items={[
              { value: "interleaved", label: "Interleaved" },
              { value: "separated", label: "Separated" },
            ]}
          />
          {graphType === "grouped-scatter" ? points : shapes("Bars", options.groupLayout === "interleaved" && gap)}
        </>
      );
    case "dose-response":
    case "grouped-lines":
    case "volcano":
      return (
        <>
          {points}
          {graphType === "volcano" && (
            <Group title="Labels">
              <Stepper
                label="Labelled genes"
                value={options.volcanoLabelCount}
                min={0}
                max={50}
                step={5}
                onChange={(volcanoLabelCount) => set({ volcanoLabelCount })}
              />
            </Group>
          )}
        </>
      );
    case "pie":
    case "donut":
      return shapes(
        "Slices",
        <Toggle label="Show percentages" checked={options.pieShowPercent} onChange={(pieShowPercent) => set({ pieShowPercent })} />,
      );
    case "heatmap":
      return (
        <Group title="Cells">
          <Toggle label="Show values" checked={options.heatmapShowValues} onChange={(heatmapShowValues) => set({ heatmapShowValues })} />
          <Toggle label="Show color legend" checked={options.heatmapShowScale} onChange={(heatmapShowScale) => set({ heatmapShowScale })} />
        </Group>
      );
    default:
      return null;
  }
}
