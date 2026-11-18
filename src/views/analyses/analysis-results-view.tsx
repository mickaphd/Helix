// The results of an analysis, laid out like a short report (no title: the toolbar names
// it): the data analyzed, what it means in plain words (with a Significant / Not
// significant pill when it has one P value), its checks, its key statistics, then one
// compact table per part of the result, the descriptive statistics, and the notes. Numbers keep same-width digits so columns line up; everything is selectable.
import type * as React from "react";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import type { AnalysisResult, Analyzed, Check, GroupDescriptives, StatRow } from "../../stats/types";
import { cn } from "../../ui/controls";
import { isSignificant, num, pStars, pValue } from "../../lib/format";

/** A P value with its stars, green when significant. */
function P({ p }: { p: number | null | undefined }) {
  if (p == null || Number.isNaN(p)) return <>—</>;
  return (
    <span className={isSignificant(p) ? "text-support-green" : "text-secondary"}>
      {pValue(p)} {pStars(p)}
    </span>
  );
}

/** Whether a normality test's P is consistent with the distribution: here a small P is a No. */
const verdict = (p: number | null) => (p == null ? "—" : p > 0.05 ? "Yes" : <span className="text-secondary">No</span>);

type Column = { label: string; numeric?: boolean };

/** One part of the result: a titled table, as wide as its content. The first
 *  column names the rows; numeric columns align right. */
function Table({ title, columns, rows }: { title?: string; columns: Column[]; rows: React.ReactNode[][] }) {
  const hasHeader = columns.some((c) => c.label);
  return (
    <section className="flex flex-col gap-2">
      {title && <h3 className="text-strong">{title}</h3>}
      <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-separator">
        <table className="border-collapse">
          {hasHeader && (
            <thead>
              <tr className="border-b border-separator">
                {columns.map((c, i) => (
                  <th
                    key={i}
                    className={cn(
                      "px-3 py-1.5 whitespace-nowrap text-small-strong text-secondary",
                      c.numeric ? "text-right" : "text-left",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="even:bg-control">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-1.5 whitespace-nowrap",
                      columns[j]?.numeric ? "text-right" : "text-left",
                      j === 0 && hasHeader && "pr-6",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The data the analysis ran on: its data sets, each a tag with its count, how they're
 *  compared, and the table's others it left out. */
function AnalyzedView({ analyzed: { sets, how, detail, left } }: { analyzed: Analyzed }) {
  const tag = (s: Analyzed["sets"][number]) => (
    <span key={s.name} className="rounded-md bg-control px-2 py-0.5 whitespace-nowrap">
      <span className="text-strong">{s.name}</span>
      {s.n != null && <span className="text-secondary"> n = {s.n}</span>}
    </span>
  );
  const between = how === "vs" ? "vs." : how === "paired" ? "→" : null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-strong">Data analyzed</h3>
      <div className="flex flex-wrap items-center gap-2">
        {how === "control" && sets.length > 1 ? (
          <>
            {tag(sets[0])}
            <span className="text-secondary">vs. each of</span>
            {sets.slice(1).map(tag)}
          </>
        ) : (
          sets.map((s, i) => [
            i > 0 && between && (
              <span key={`${s.name}-to`} className="text-secondary">
                {between}
              </span>
            ),
            tag(s),
          ])
        )}
        {detail && <span className="text-secondary">{detail}</span>}
      </div>
      {left.length > 0 && <p className="text-small text-secondary">Not included: {left.join(", ")}</p>}
    </section>
  );
}

/** The test's conditions, checked by R: a green tick when one holds, an orange warning when
 *  it may not. */
function Checks({ checks }: { checks: Check[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-strong">Checks</h3>
      <ul className="flex max-w-prose flex-col gap-1.5">
        {checks.map((c, i) => (
          <li key={i} className="flex gap-2">
            {c.ok ? (
              <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-support-green" />
            ) : (
              <WarningIcon className="mt-0.5 size-4 shrink-0 text-support-orange" />
            )}
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The test's own P value, shown as Significant or not by the heading: its only one, or
 *  the one named "P value…" beside a side check (a t test's F test); none when it has
 *  several (one per group or factor). */
export function headline(stats: StatRow[]): number | null {
  const pRows = stats.filter((s) => s.p);
  const main = pRows.length === 1 ? pRows : pRows.filter((s) => s.label.startsWith("P value"));
  return main.length === 1 ? main[0].value : null;
}

/** The rows of the Descriptive statistics analysis, in order. */
// prettier-ignore
const DESCRIPTIVE_ROWS: [string, (g: GroupDescriptives) => React.ReactNode][] = [
  ["N", (g) => g.n],
  ["Mean", (g) => num(g.mean)],
  ["SD", (g) => num(g.sd)],
  ["SEM", (g) => num(g.sem)],
  ["95% CI of mean", (g) => (g.ciLow == null && g.ciHigh == null ? "—" : `${num(g.ciLow)} to ${num(g.ciHigh)}`)],
  ["Coefficient of variation", (g) => (g.cv == null ? "—" : `${num(g.cv)}%`)],
  ["Geometric mean", (g) => num(g.geoMean)],
  ["Minimum", (g) => num(g.min)],
  ["25th percentile", (g) => num(g.q1)],
  ["Median", (g) => num(g.median)],
  ["75th percentile", (g) => num(g.q3)],
  ["Maximum", (g) => num(g.max)],
  ["Range", (g) => num(g.range)],
];

export function AnalysisResultsView({ result }: { result: AnalysisResult }) {
  const headlineP = headline(result.stats);
  // Comparisons of means give their 95% CI (adjusted as their P is); ranks don't.
  const withCi = result.comparisons?.some((c) => c.low !== undefined) ?? false;
  const showP = headlineP != null && !Number.isNaN(headlineP);
  const groups = result.groups;
  const matrix = result.matrix;

  return (
    <div className="flex max-w-4xl flex-col gap-7 px-8 py-6 text-regular text-primary tabular-nums select-text">
      {result.analyzed && <AnalyzedView analyzed={result.analyzed} />}

      {(result.summary || showP) && (
        <section className="flex flex-col gap-2">
          {/* The toolbar names the analysis: no title here, only whether its own P value is
              significant, beside what it means. */}
          <h3 className="flex items-center gap-2.5 text-strong">
            In plain words
            {showP && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-small-strong",
                  isSignificant(headlineP) ? "bg-support-green/15 text-support-green" : "bg-control text-secondary",
                )}
              >
                {isSignificant(headlineP) ? `Significant ${pStars(headlineP)}` : "Not significant"}
              </span>
            )}
          </h3>
          {result.summary && <p className="max-w-prose">{result.summary}</p>}
        </section>
      )}

      {result.checks && <Checks checks={result.checks} />}

      {result.normality && (
        <Table
          columns={[
            { label: "" },
            { label: "W", numeric: true },
            { label: "P value", numeric: true },
            { label: "Normal?" },
            { label: "W (log)", numeric: true },
            { label: "P value (log)", numeric: true },
            { label: "Lognormal?" },
          ]}
          rows={result.normality.map((r) => [
            r.group,
            num(r.w),
            r.p == null ? "—" : pValue(r.p),
            verdict(r.p),
            num(r.logW),
            r.logP == null ? "—" : pValue(r.logP),
            verdict(r.logP),
          ])}
        />
      )}

      {result.fit && (
        <Table
          title="Best-fit values"
          columns={[{ label: "" }, ...result.fit.sets.map((s) => ({ label: s, numeric: true }))]}
          rows={result.fit.rows.map((row) => [
            <span className="text-secondary">{row.label}</span>,
            ...(row.ranges?.map(([low, high]) => (low == null && high == null ? "—" : `${num(low)} to ${num(high)}`)) ??
              row.values!.map((v) => (row.p ? <P p={v} /> : num(v)))),
          ])}
        />
      )}

      {result.curveOutliers && result.curveOutliers.length > 0 && (
        <Table
          title="Outliers (left out of the fit)"
          columns={[
            { label: "" },
            ...(result.fit && result.fit.sets.length > 1 ? [{ label: "Data set" }] : []),
            { label: "X", numeric: true },
            { label: "Y", numeric: true },
          ]}
          rows={result.curveOutliers.map((o) => [
            o.label,
            ...(result.fit && result.fit.sets.length > 1 ? [o.set] : []),
            num(o.x),
            num(o.y),
          ])}
        />
      )}

      {result.interpolated && result.interpolated.length > 0 && (
        <Table
          title="Interpolated values"
          columns={[
            { label: "" },
            { label: "Y", numeric: true },
            { label: "X", numeric: true },
            ...(result.interpolated[0].concentration !== undefined
              ? [{ label: "Concentration (10^X)", numeric: true }]
              : []),
            { label: "" },
          ]}
          rows={result.interpolated.map((u) => [
            u.label,
            num(u.y),
            num(u.x),
            ...(u.concentration !== undefined ? [num(u.concentration)] : []),
            <span className="text-secondary">{u.extrapolated ? "extrapolated" : ""}</span>,
          ])}
        />
      )}

      {(result.equation || result.stats.length > 0) && (
        <Table
          columns={[{ label: "" }, { label: "", numeric: true }]}
          rows={[
            ...(result.equation ? [[<span className="text-secondary">Equation</span>, result.equation]] : []),
            ...result.stats.map((s) => [
              <span className="text-secondary">{s.label}</span>,
              s.p ? <P p={s.value} /> : num(s.value),
            ]),
          ]}
        />
      )}

      {result.comparisons && result.comparisons.length > 0 && (
        <Table
          title={result.comparisonsLabel ?? "Multiple comparisons"}
          columns={[
            { label: "Comparison" },
            { label: result.comparisonsEffect ?? "Difference", numeric: true },
            ...(withCi ? [{ label: "95% CI", numeric: true }] : []),
            { label: "P value", numeric: true },
          ]}
          rows={result.comparisons.map((c) => [
            c.group2 ? `${c.group1} vs. ${c.group2}` : c.group1,
            num(c.diff),
            ...(withCi ? [c.low == null && c.high == null ? "—" : `${num(c.low)} to ${num(c.high)}`] : []),
            <P p={c.p} />,
          ])}
        />
      )}

      {matrix && (
        <>
          <Table
            title={matrix.label ?? "Correlation matrix"}
            columns={[{ label: "" }, ...matrix.variables.map((v) => ({ label: v, numeric: true }))]}
            rows={matrix.variables.map((name, i) => [
              name,
              ...matrix.variables.map((_, j) =>
                i === j ? (
                  <span className="text-secondary">1</span>
                ) : (
                  <span className={cn(isSignificant(matrix.p[i]?.[j]) && "text-support-green")}>
                    {num(matrix.r[i]?.[j])}
                  </span>
                ),
              ),
            ])}
          />
          <p className="-mt-5 text-small text-secondary">Green: a significant correlation (P &lt; 0.05).</p>
          <Table
            title="P values"
            columns={[{ label: "" }, ...matrix.variables.map((v) => ({ label: v, numeric: true }))]}
            rows={matrix.variables.map((name, i) => [
              name,
              ...matrix.variables.map((_, j) =>
                i === j ? <span className="text-secondary">—</span> : <P p={matrix.p[i]?.[j]} />,
              ),
            ])}
          />
        </>
      )}

      {result.correlations && result.correlations.length > 0 && (
        <Table
          title="Correlations (X vs. each Y)"
          columns={[
            { label: "" },
            { label: "r", numeric: true },
            { label: "95% CI", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.correlations.map((c) => [
            c.variable,
            num(c.r),
            c.low == null && c.high == null ? "—" : `${num(c.low)} to ${num(c.high)}`,
            <P p={c.p} />,
          ])}
        />
      )}

      {result.areas && result.areas.length > 0 && (
        <Table
          title="Area under the curve"
          columns={[{ label: "" }, { label: "Area", numeric: true }, { label: "N", numeric: true }]}
          rows={result.areas.map((a) => [a.variable, num(a.area), a.n])}
        />
      )}

      {result.outlierGroups?.[0]?.grubbs && (
        <Table
          title="Outliers by column"
          columns={[
            { label: "" },
            { label: "Points", numeric: true },
            { label: "Farthest value", numeric: true },
            { label: "G", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.outlierGroups.map((g) => [
            g.group,
            g.points,
            num(g.grubbs?.extreme),
            num(g.grubbs?.g),
            <P p={g.grubbs?.p} />,
          ])}
        />
      )}

      {result.outlierGroups && result.outlierGroups.length > 0 && !result.outlierGroups[0].grubbs && (
        <Table
          title="Outliers by column"
          columns={[
            { label: "" },
            { label: "Points", numeric: true },
            { label: "Outliers", numeric: true },
            { label: "%", numeric: true },
            { label: "Robust mean", numeric: true },
          ]}
          rows={result.outlierGroups.map((g) => [g.group, g.points, g.outliers, num(g.percent), num(g.robustMean)])}
        />
      )}

      {result.survivalGroups && result.survivalGroups.length > 0 && (
        <Table
          title="Survival by group"
          columns={[
            { label: "" },
            { label: "Subjects", numeric: true },
            { label: "Events", numeric: true },
            { label: "Median survival", numeric: true },
            { label: "95% CI of median", numeric: true },
          ]}
          rows={result.survivalGroups.map((g) => [
            g.group,
            g.subjects,
            g.events,
            g.median == null ? "Undefined" : num(g.median),
            `${g.low == null ? "—" : num(g.low)} to ${g.high == null ? "—" : num(g.high)}`,
          ])}
        />
      )}

      {result.hazardRatios && result.hazardRatios.length > 0 && (
        <Table
          title="Hazard ratios"
          columns={[
            { label: "" },
            { label: "Hazard ratio", numeric: true },
            { label: "95% CI", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.hazardRatios.map((h) => [
            h.comparison,
            num(h.ratio),
            `${num(h.low)} to ${num(h.high)}`,
            <P p={h.p} />,
          ])}
        />
      )}

      {result.coefficients && result.coefficients.length > 0 && (
        <Table
          title="Coefficients"
          columns={[
            { label: "" },
            { label: "Estimate", numeric: true },
            { label: "Std. error", numeric: true },
            { label: result.coefficientStatistic ?? "t", numeric: true },
            { label: "P value", numeric: true },
            { label: "95% CI", numeric: true },
          ]}
          rows={result.coefficients.map((c) => [
            c.term,
            num(c.estimate),
            num(c.stdError),
            num(c.t),
            <P p={c.p} />,
            c.low == null && c.high == null ? "—" : `${num(c.low)} to ${num(c.high)}`,
          ])}
        />
      )}

      {groups.length > 0 &&
        (result.testType === "descriptive-statistics" ? (
          // The full summary: one column per data set, one row per statistic.
          <Table
            title="Descriptive statistics"
            columns={[{ label: "" }, ...groups.map((g) => ({ label: g.name, numeric: true }))]}
            rows={DESCRIPTIVE_ROWS.map(([label, of]) => [label, ...groups.map(of)])}
          />
        ) : (
          <Table
            title="Descriptive statistics"
            columns={[
              { label: "" },
              { label: "Mean", numeric: true },
              { label: "SD", numeric: true },
              { label: "SEM", numeric: true },
              { label: "Median", numeric: true },
              { label: "N", numeric: true },
            ]}
            rows={groups.map((g) => [g.name, num(g.mean), num(g.sd), num(g.sem), num(g.median), g.n])}
          />
        ))}

      {result.notes && <p className="max-w-prose text-small text-secondary">{result.notes}</p>}
    </div>
  );
}
