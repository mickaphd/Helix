# Helix

**Scientific data analysis, simplified.**

Organize, analyze and visualize scientific data, from raw numbers to publication-ready
graphs. Helix is a free, open-source and private alternative to GraphPad Prism for macOS.

Three engines do the work: a fast data grid built for Helix, **R**, the reference for
statistics (through [webR](https://github.com/r-wasm/webr), R compiled to WebAssembly), and
**[Plotly](https://plotly.com/javascript/)** for the graphs. Everything runs on your Mac.

![Helix: a table, its analyses and a graph](docs/screenshot.png)

## Download

Get the latest version from the [Releases page](https://github.com/mickaphd/Helix/releases/latest):

- `Helix_…_aarch64.dmg` for Macs with Apple Silicon (M1 and later)
- `Helix_…_x64.dmg` for Macs with an Intel processor

Requires macOS 13.3 (Ventura) or later. Open the DMG and drag **Helix** into the
**Applications** folder. Helix is signed and notarized by Apple, so it opens like any other app.

When a new version is out, Helix tells you (Helix › Check for Updates…) and installs it
for you: it relaunches with your projects.

## What Helix does

Each **table** holds its own **analyses** and **graphs**. Change a value, and every result
and figure that uses it updates at once.

### Tables

Six table types. Each guides how data are entered, and offers every analysis and graph
its data allow:

- **Column:** groups side by side (control, doses, treatments)
- **XY:** a response against a dose, a time or a concentration
- **Grouped:** groups across rows (time points, genes), with replicates
- **Multiple Variables:** one row per subject, one column per variable
- **Contingency:** counts of outcomes
- **Survival:** one subject per row, its time, and whether the event happened

And a spreadsheet that feels like one:

- Copy and paste with Excel or Numbers, fill down, find, resize columns, keep the titles
  visible as you scroll
- Name each row (a mouse, a patient, a gene): the names follow into results and graphs
- Exclude a value from the analyses without deleting it

### Analyses

- **Guided:** an assistant asks which data sets to analyze, whether they are
  paired and whether they follow a normal distribution (or checks it for you with
  Shapiro-Wilk), then runs the right test
- **Every number comes from R**, the reference for statistics
- **Two groups:** unpaired, Welch, paired, ratio and lognormal t tests, with Cohen's d and
  Hedges' g; Mann-Whitney, Wilcoxon; one group against a value, its mean or geometric mean
- **More groups:** one-way ANOVA (or Welch's, without equal SDs; of geometric means: lognormal),
  repeated-measures ANOVA with the Geisser-Greenhouse correction, or a mixed-effects model
  (REML, Kenward-Roger) when subjects miss values, Kruskal-Wallis, Friedman; then every pair (Tukey,
  Games-Howell, Dunnett's T3, Dunn), the pairs chosen (Bonferroni, Šidák, Holm-Šidák,
  Fisher's LSD) or each group against a control (Dunnett)
- **Grouped data:** two-way ANOVA (ordinary, with Tukey, Dunnett, Games-Howell or corrected
  pairs; repeated measures with the Geisser-Greenhouse correction; Scheirer-Ray-Hare) and
  multiple t tests with Holm or FDR correction
- **Curves:** dose-response (4PL, 3PL, 5PL) with the EC50 or IC50 (and the EC10, EC20, EC80 or
  EC90) and every parameter's 95% CI, several data sets at once or two curves compared,
  outliers left out by ROUT; standard curves read for your unknowns (ELISA); exponential,
  logistic and Gompertz growth, one- and two-phase decay (doubling time, half-lives),
  Michaelis-Menten, lines and polynomials; replicates taken as they are
- **Before you test:** a normality and lognormality test that says in plain words which
  tests suit your data; outliers found by ROUT or Grubbs
- **Counts:** Fisher's exact and chi-square tests (Yates' or not), the chi-square test for
  trend, with the odds ratio, the relative risk, the difference of risks and the number
  needed to treat, sensitivity, specificity and predictive values, Phi and Cramér's V
- **Checking assumptions:** QQ plots of your data sets, residual plots of a regression (against
  X or as a QQ plot)
- **Two variables:** a regression line through any two variables of a table, with its
  equation, r (with its 95% CI), R² and P; a logistic regression for a yes/no outcome, with its odds ratio
- **Survival:** Kaplan-Meier with median survival, log-rank, trend and Gehan-Breslow-Wilcoxon
  tests, hazard ratios, and Cox regression
- **Transform or normalize:** logarithms, normalized 0 to 100 %, percent of a control,
  z-scores, as a new table that follows its own and can be analyzed and graphed
- **Clear results:** the exact test that ran and whether it is significant, the data it
  compared, what it means in plain words, its conditions checked (normality, equal SDs…),
  every statistic, multiple comparisons and descriptive statistics, ready to copy
- Analyses follow the data: rename a column and they follow it, edit a value and they run again

### Graphs

- **Ready for a paper by default**
- **Statistics on the graph:** significance stars, P values or group letters from your analyses, between
  groups or, on grouped bars, points and boxes, between a two-way ANOVA's cells; regression
  lines with their confidence or prediction band and equation, any fitted curve with its best-fit values,
  Kaplan-Meier curves with their confidence band and the number at risk
- **Notes and tags on everything:** a note on each table, analysis and graph, and the Finder's
  color tags to find them in a busy project, saved in the project
- **One table, many figures:** a graph shows all of a table's data sets or only those you
  tick, each in the same color everywhere; its stars come from an analysis of them
- **Every kind of figure:** dot plots, bars, box and violin, histograms, lines, heatmaps, volcano plots
  (from your own results, or computed by Helix from replicates), survival curves
- **Colors that work:** 15 palettes from the scientific literature (Okabe-Ito, Paul Tol,
  Viridis, Batlow…), colorblind-friendly ones first, each reversible; or make your own,
  kept on your Mac
- **Style every series:** color, point shape, dashed lines, fill patterns; and the whole graph:
  fill opacity, outlines, error bars (thickness, caps, color, direction)
- **Style single points:** click or drag over them to change their color, shape or size, or
  show their name; on a volcano plot, find genes by name
- **Match:** give a graph the look of another one, choosing what it takes
- **Lay it out:** move the legend and notes, resize by dragging an axis or typing a size, set
  each axis's range and step, draw reference lines (a control's level, a threshold) with
  their text, white or transparent background
- **Export** as PNG or JPG at 150, 300 or 600 DPI, at their true printed size, or as SVG; or
  copy and paste into Keynote, PowerPoint or Word

### Projects

- A native Mac app: real menus and shortcuts, light and dark mode, your accent color,
  resizable sidebar and inspector
- Undo and redo everything, across the whole project
- Several projects at once, each in its own window; the ones still open when you quit come
  back at the next launch
- Open projects: a Helix file (`.hlx`) is plain JSON, described in
  [FILE-FORMAT.md](FILE-FORMAT.md), so your data are never locked in
- Open methods: how each analysis is computed and checked is in [METHODS.md](METHODS.md)

**Try it:** Help › Sample Project opens a made-up study told as a paper's figures, from cells
to mice to patients, with every kind of table ([also here](samples/Helix%20Sample.hlx)).

## Privacy

Helix works entirely on your Mac: your data never leave it, and there is no
telemetry in the app. Its only connection is a daily check on GitHub for a newer version.

## Building from source

You need [Node.js](https://nodejs.org) 24 or later, [Rust](https://rustup.rs), and the
Xcode Command Line Tools (`xcode-select --install`).

```bash
npm ci            # install
npm run dev       # run Helix with live reload
npm test          # check every analysis and graph against their reference results
npm run build     # build the two DMGs
```

Building the two DMGs needs both Mac targets for Rust, once:
`rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

## License

Helix is free software: you can redistribute it and modify it under the terms of the
[GNU General Public License](LICENSE), version 3 or later. It comes with no warranty.

© 2026 mickaphd · [helix-desktop.com](https://www.helix-desktop.com)

Helix is free and always will be. If it saves you time, you can
[buy me a coffee](https://buymeacoffee.com/mickaphd) ☕

## Acknowledgments

Helix stands on the shoulders of [R](https://www.r-project.org) and
[webR](https://github.com/r-wasm/webr), which bring R to the app, R's
[survival](https://github.com/therneau/survival) package for survival analysis,
[Plotly.js](https://plotly.com/javascript/) for the graphs, [Phosphor Icons](https://phosphoricons.com)
for its icons, and [Tauri](https://tauri.app) and [React](https://react.dev) for the app itself. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for all of them and their licenses.

GraphPad Prism is a trademark of GraphPad Software, LLC. Helix is an independent project,
not affiliated with or endorsed by GraphPad Software.
