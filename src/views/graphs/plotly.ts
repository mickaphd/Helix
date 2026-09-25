// Plotly, loaded on the first graph shown rather than at startup. The full
// `dist-min` build includes WebGL traces (`scattergl`) for large scatter plots (volcano).
type Plotly = {
  react: (el: HTMLElement, data: unknown[], layout: object, config: object) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
  toImage: (
    figure: HTMLElement | { data: unknown[]; layout: object },
    opts: { format: "png" | "jpeg" | "svg"; width: number; height: number; scale: number },
  ) => Promise<string>;
};

let plotly: Promise<Plotly> | null = null;

export const loadPlotly = () => (plotly ??= import("plotly.js-dist-min").then((m) => m.default as Plotly));
