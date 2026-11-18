// "QQ plot": whether each data set's values follow a normal distribution: its sorted values
// against the normal quantiles they would sit at (R's qqnorm: ppoints, qnorm), with the
// line of a normal of the data set's own mean and SD. Values on that line are normal ones;
// a bow or S says how they depart.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { ppoints, qnorm } from "../../lib/normal";
import { mean, sd } from "../../lib/summary";
import { seriesMarker, xyLayout, type Paint } from "./plot-helpers";

/** A sample's QQ points: the normal quantile each sorted value stands for, and the value. */
export function qqPoints(values: number[]): { z: number[]; y: number[] } {
  const y = [...values].sort((a, b) => a - b);
  return { z: ppoints(y.length).map(qnorm), y };
}

/** The QQ traces of named samples: their points, then each one's normal line, in its color. */
export function qqTraces(samples: { name: string; values: number[] }[], paint: Paint): unknown[] {
  return samples.flatMap(({ name, values }, i) => {
    if (values.length < 2) return [];
    const { z, y } = qqPoints(values);
    const [m, s] = [mean(values), sd(values)];
    const ends = [z[0], z[z.length - 1]];
    return [
      { type: "scatter", mode: "markers", name, x: z, y, marker: seriesMarker(paint, name, i), hoverinfo: "x+y" },
      {
        type: "scatter",
        mode: "lines",
        name,
        legendgroup: name,
        showlegend: false,
        x: ends,
        y: ends.map((e) => m + s * e),
        line: { ...paint.line(name, i), dash: "dash" },
        hoverinfo: "skip",
      },
    ];
  });
}

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const samples = columns.map((c) => ({ name: c.name, values: c.values }));
  return {
    data: qqTraces(samples, paint),
    layout: xyLayout({ ...options, xScale: "linear" }, "Normal quantile (z)", samples.length, { yName: "Value" }),
  };
}

export const qqPlot: GraphModule = { label: "QQ plot", family: "column", points: () => true, build };
