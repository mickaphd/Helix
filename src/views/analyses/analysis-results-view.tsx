// The results of an analysis, laid out like a short report: the test's name (with a
// Significant / Not significant pill when it has one P value), its key statistics,
// then one compact table per part of the result, the descriptive statistics, and the
// notes. Numbers keep same-width digits so columns line up; everything is selectable.
import type * as React from "react";
import type { AnalysisResult } from "../../stats/types";
import { ANALYSES } from "../../stats";
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

export function AnalysisResultsView({ result }: { result: AnalysisResult }) {
  // A test with one P value says in its title whether it is significant.
  const pRows = result.stats.filter((s) => s.p);
  const headlineP = pRows.length === 1 ? pRows[0].value : null;
  const groups = result.groups;
  // The 95% CI and Min/Max/Range only come from the Descriptive statistics analysis.
  const showCi = groups.some((g) => g.ciLow != null || g.ciHigh != null);
  const showRange = groups.some((g) => g.min != null || g.max != null || g.range != null);
  const matrix = result.matrix;

  return (
    <div className="flex max-w-4xl flex-col gap-7 px-8 py-6 text-regular text-primary tabular-nums select-text">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h2 className="text-large-strong">{ANALYSES[result.testType].label}</h2>
          {headlineP != null && !Number.isNaN(headlineP) && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-small-strong",
                isSignificant(headlineP) ? "bg-support-green/15 text-support-green" : "bg-control text-secondary",
              )}
            >
              {isSignificant(headlineP) ? `Significant ${pStars(headlineP)}` : "Not significant"}
            </span>
          )}
        </div>
        {result.subtitle && <p className="text-secondary">{result.subtitle}</p>}
      </header>

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
          columns={[{ label: "Comparison" }, { label: "Difference", numeric: true }, { label: "P value", numeric: true }]}
          rows={result.comparisons.map((c) => [
            c.group2 ? `${c.group1} vs. ${c.group2}` : c.group1,
            num(c.diff),
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
              ...matrix.variables.map((_, j) => (i === j ? <span className="text-secondary">—</span> : <P p={matrix.p[i]?.[j]} />)),
            ])}
          />
        </>
      )}

      {result.correlations && result.correlations.length > 0 && (
        <Table
          title="Correlations (X vs. each Y)"
          columns={[{ label: "" }, { label: "r", numeric: true }, { label: "P value", numeric: true }]}
          rows={result.correlations.map((c) => [c.variable, num(c.r), <P p={c.p} />])}
        />
      )}

      {result.areas && result.areas.length > 0 && (
        <Table
          title="Area under the curve"
          columns={[{ label: "" }, { label: "Area", numeric: true }, { label: "N", numeric: true }]}
          rows={result.areas.map((a) => [a.variable, num(a.area), a.n])}
        />
      )}

      {result.outlierGroups && result.outlierGroups.length > 0 && (
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

      {result.coefficients && result.coefficients.length > 0 && (
        <Table
          title="Coefficients"
          columns={[
            { label: "" },
            { label: "Estimate", numeric: true },
            { label: "Std. error", numeric: true },
            { label: "t", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.coefficients.map((c) => [c.term, num(c.estimate), num(c.stdError), num(c.t), <P p={c.p} />])}
        />
      )}

      {groups.length > 0 && (
        <Table
          title="Descriptive statistics"
          columns={[
            { label: "" },
            { label: "Mean", numeric: true },
            { label: "SD", numeric: true },
            { label: "SEM", numeric: true },
            ...(showCi ? [{ label: "95% CI of mean", numeric: true }] : []),
            { label: "Median", numeric: true },
            ...(showRange
              ? [
                  { label: "Min", numeric: true },
                  { label: "Max", numeric: true },
                  { label: "Range", numeric: true },
                ]
              : []),
            { label: "N", numeric: true },
          ]}
          rows={groups.map((g) => [
            g.name,
            num(g.mean),
            num(g.sd),
            num(g.sem),
            ...(showCi
              ? [g.ciLow == null && g.ciHigh == null ? "—" : `${num(g.ciLow)} to ${num(g.ciHigh)}`]
              : []),
            num(g.median),
            ...(showRange ? [num(g.min), num(g.max), num(g.range)] : []),
            g.n,
          ])}
        />
      )}

      {result.notes && <p className="max-w-prose text-small text-secondary">{result.notes}</p>}
    </div>
  );
}
