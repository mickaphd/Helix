// Every result's report, the same for every analysis: the data it ran on, what it means in
// plain words, and its conditions checked. Added once the test has run; a part that fails
// is left out, never the result.
import { readTable } from "../../lib/dataset";
import type { TableData } from "../../store/types";
import type { AnalysisParams, AnalysisResult, AnalysisType, Column } from "../types";
import { analyzedOf } from "./analyzed";
import { checksOf } from "./checks";
import { conclusionOf } from "./conclusion";

const tried = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

export async function withReport(
  type: AnalysisType,
  params: AnalysisParams | undefined,
  data: TableData,
  columns: Column[],
  result: AnalysisResult,
): Promise<AnalysisResult> {
  const table = readTable(data);
  const analyzed = tried(() => analyzedOf(type, params, table, result));
  const summary = result.summary ?? tried(() => conclusionOf(type, params, result, analyzed, table));
  const checks = await checksOf(type, params, columns, result).catch(() => []);
  return {
    ...result,
    ...(analyzed ? { analyzed } : {}),
    ...(summary ? { summary } : {}),
    ...(checks.length ? { checks } : {}),
  };
}
