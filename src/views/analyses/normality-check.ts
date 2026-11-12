// "Not sure? Check with Shapiro-Wilk", offered on every Gaussian? wizard step.
// Runs the real test on the data sets chosen and reports a plain-language
// verdict. Resolves to the answer the wizard should proceed with, or null if
// the test couldn't run.
import { alert } from "../../native";
import { runAnalysis } from "../../stats";
import { pText } from "../../lib/format";
import type { TableData } from "../../store/types";

/** `sets`: the data sets the test will run on (all by default). */
export async function checkNormality(data: TableData, sets?: string[]): Promise<boolean | null> {
  const outcome = await runAnalysis("shapiro-wilk", data, sets && { sets });
  if ("error" in outcome) {
    await alert("Couldn't Run the Shapiro-Wilk Test", outcome.error, "error");
    return null;
  }
  const rows = outcome.normality ?? [];
  // A data set the test can't take (too few values, or all identical) is said, not judged.
  const tested = rows.flatMap((r) => (r.p == null ? [] : [r.p]));
  const summary = rows
    .map((r) => `${r.group}: ${r.p == null ? "not tested (too few or identical values)" : pText(r.p)}`)
    .join("\n");
  if (!tested.length) {
    await alert("Couldn't Run the Shapiro-Wilk Test", summary, "error");
    return null;
  }
  const gaussian = tested.every((p) => p > 0.05);
  await alert(
    gaussian ? "Consistent with a Normal Distribution" : "Not Consistent with a Normal Distribution",
    `Shapiro-Wilk test\n${summary}`,
    "info",
  );
  return gaussian;
}
