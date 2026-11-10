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
  const pValues = outcome.groups.map(
    (g) => outcome.stats.find((s) => s.label === `${g.name} — P value`)?.value ?? null,
  );
  // A data set the test can't take (too few values, or all identical) is said, not judged.
  const tested = pValues.filter((p) => p != null);
  const summary = outcome.groups
    .map((g, i) => `${g.name}: ${pValues[i] == null ? "not tested (too few or identical values)" : pText(pValues[i])}`)
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
