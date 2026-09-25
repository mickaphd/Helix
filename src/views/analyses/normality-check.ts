// "Not sure? Check with Shapiro-Wilk", offered on every Gaussian? wizard step.
// Runs the real test on the actual columns and reports a plain-language
// verdict. Resolves to the answer the wizard should proceed with, or null if
// the test couldn't run.
import { alert } from "../../native";
import { runAnalysis } from "../../stats";
import type { TableData } from "../../store/types";

export async function checkNormality(data: TableData): Promise<boolean | null> {
  const outcome = await runAnalysis("shapiro-wilk", data);
  if ("error" in outcome) {
    await alert("Couldn't run the Shapiro-Wilk test", outcome.error, "error");
    return null;
  }
  const pValues = outcome.groups.map(
    (g) => outcome.stats.find((s) => s.label === `${g.name} — P value`)?.value ?? null,
  );
  const gaussian = pValues.every((p) => p != null && !Number.isNaN(p) && p > 0.05);
  const summary = outcome.groups
    .map((g, i) => `${g.name}: P = ${pValues[i] == null ? "—" : pValues[i]!.toFixed(4)}`)
    .join("\n");
  await alert(
    gaussian ? "Consistent with a normal distribution" : "Not consistent with a normal distribution",
    `Shapiro-Wilk test\n${summary}`,
    "info",
  );
  return gaussian;
}
