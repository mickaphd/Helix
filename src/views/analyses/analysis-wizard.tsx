// Asks an analysis's questions (wizards.ts) like a macOS assistant: one question at
// a time, Cancel, Back, then Next — or Run on the last one (Create for a transformed
// table). A "Not sure" answer runs Shapiro-Wilk and answers for the user. Mounts fresh
// for each analysis.
import * as React from "react";
import { Button, Checkbox, Field, NumberInput, RadioList } from "../../ui/controls";
import { Dialog } from "../../ui/dialog";
import { readTable } from "../../lib/dataset";
import type { TableData, TableType } from "../../store/types";
import { useProjectActions, useProjectStore } from "../../store/use-project-store";
import { checkNormality } from "./normality-check";
import { useAnalysisLauncher } from "./use-analysis-launcher";
import { analysisLabel } from ".";
import {
  answersFor,
  chosenSets,
  toggled,
  TRANSFORM_WIZARD,
  WIZARDS,
  type Answer,
  type Answers,
  type Question,
  type Wizard,
} from "./wizards";

const NOT_SURE = { value: "check", label: "Not sure — check for normality first (Shapiro-Wilk)" };

export function AnalysisWizard() {
  const { nodes, selector, closeSelector } = useProjectStore();
  const { createTransformed } = useProjectActions();
  const launch = useAnalysisLauncher();
  if (selector?.kind !== "analysis-params") return null;
  const { data, tableType } = nodes[selector.tableId] ?? {};
  if (!data) return null;
  const table = readTable(data);
  const steps = { title: analysisLabel(selector.testType), data, tableType, onClose: closeSelector };
  if (selector.testType === "transform")
    return (
      <Steps
        {...steps}
        wizard={TRANSFORM_WIZARD}
        initial={{}}
        done="Create"
        onDone={(a) => {
          createTransformed(selector.tableId, TRANSFORM_WIZARD.finish(a));
          closeSelector();
        }}
      />
    );
  const wizard = WIZARDS[selector.testType];
  if (!wizard) return null;
  return (
    <Steps
      {...steps}
      wizard={wizard}
      initial={answersFor(wizard, table, tableType, selector.forGraph?.sets)}
      done="Run"
      onDone={(a) => {
        const { type, params } = wizard.finish(a, table, tableType);
        launch(selector.tableId, type, params, selector.forGraph);
        closeSelector();
      }}
    />
  );
}

/** The answer a question starts with: the one given before (going back), else its first option. */
function initialAnswer(q: Question, given: Answer | undefined): Answer | null {
  if (q.kind === "choice") return q.options.some((o) => o.value === given) ? given! : q.options[0].value;
  if (q.kind === "number") return typeof given === "number" ? given : q.initial;
  return Array.isArray(given) ? given.filter((n) => q.options.includes(n)) : q.options;
}

function Steps({
  title,
  wizard,
  data,
  tableType,
  initial,
  done,
  onDone,
  onClose,
}: {
  title: string;
  wizard: Pick<Wizard, "questions">;
  data: TableData;
  tableType?: TableType;
  /** Answers given beforehand (a graph's data sets), each question starting from its own. */
  initial: Answers;
  /** The last step's button: Run, Create. */
  done: string;
  /** Every question answered. */
  onDone: (answers: Answers) => void;
  onClose: () => void;
}) {
  const table = readTable(data);
  const [answers, setAnswers] = React.useState<Answers>(initial);
  const [step, setStep] = React.useState(0);
  const [checking, setChecking] = React.useState(false);
  // Each question takes the keyboard (its chosen answer), so ↑↓ and Return go on working.
  const field = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const input = (selector: string) => field.current?.querySelector<HTMLInputElement>(selector);
    (input("input:checked") ?? input("input"))?.focus();
  }, [step]);
  const asked = (a: Answers) => wizard.questions(a, table, tableType).filter((q): q is Question => q !== false);
  const q = asked(answers)[step];
  const [value, setValue] = React.useState<Answer | null>(() => initialAnswer(q, initial[q.id]));

  const go = (to: number, a: Answers) => {
    const next = asked(a)[to];
    setAnswers(a);
    setStep(to);
    setValue(initialAnswer(next, a[next.id]));
  };
  const last = value !== NOT_SURE.value && asked({ ...answers, [q.id]: value ?? undefined }).length === step + 1;

  const next = async () => {
    let answer = value!;
    if (answer === NOT_SURE.value) {
      setChecking(true);
      const gaussian = await checkNormality(data, chosenSets(answers));
      setChecking(false);
      if (gaussian == null) return;
      answer = gaussian ? "yes" : "no";
    }
    const a = { ...answers, [q.id]: answer };
    if (asked(a).length > step + 1) go(step + 1, a);
    else {
      onDone(a);
    }
  };

  const ready = value !== null && !(Array.isArray(value) && value.length < (q.kind === "names" ? (q.min ?? 1) : 1));

  return (
    <Dialog
      open
      onClose={checking ? undefined : onClose}
      onReturn={ready && !checking ? () => void next() : undefined}
      title={title}
      description={checking ? "Running the Shapiro-Wilk normality test…" : q.ask}
      footer={
        !checking && (
          <>
            {step > 0 && <Button onClick={() => go(step - 1, answers)}>Back</Button>}
            <Button variant="accent" disabled={!ready} onClick={() => void next()}>
              {last ? done : "Next"}
            </Button>
          </>
        )
      }
    >
      {!checking && (
        <div ref={field}>
          <AnswerField question={q} value={value} onChange={setValue} />
        </div>
      )}
    </Dialog>
  );
}

function AnswerField({
  question: q,
  value,
  onChange,
}: {
  question: Question;
  value: Answer | null;
  onChange: (value: Answer | null) => void;
}) {
  if (q.kind === "choice") {
    return (
      <RadioList
        value={value as string}
        onChange={onChange}
        options={q.normality ? [...q.options, NOT_SURE] : q.options}
      />
    );
  }
  if (q.kind === "number") {
    return (
      <Field label={q.label}>
        <NumberInput value={value as number | null} onChange={onChange} min={q.min} max={q.max} step={q.step} />
      </Field>
    );
  }
  const ticked = value as string[];
  return (
    <div className="flex flex-col gap-2">
      {q.options.map((name) => (
        <label key={name} className="flex items-center gap-2 text-regular">
          <Checkbox checked={ticked.includes(name)} onChange={(on) => onChange(toggled(q.options, ticked, name, on))} />
          {name}
        </label>
      ))}
    </div>
  );
}
