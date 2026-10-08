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
  const gaussian = pValues.every((p) => p != null && !Number.isNaN(p) && p > 0.05);
  const summary = outcome.groups.map((g, i) => `${g.name}: ${pText(pValues[i])}`).join("\n");
  await alert(
    gaussian ? "Consistent with a Normal Distribution" : "Not Consistent with a Normal Distribution",
    `Shapiro-Wilk test\n${summary}`,
    "info",
  );
  return gaussian;
}
