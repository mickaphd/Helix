import * as React from "react";
import { Dialog } from "../ui/dialog";
import { cn } from "../ui/controls";

export interface SelectorOption<T extends string = string> {
  value: T;
  label: string;
}

/** ↑↓ move the focus between the list's rows. */
function moveFocus(e: React.KeyboardEvent<HTMLUListElement>) {
  const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const rows = [...e.currentTarget.querySelectorAll("button")];
  rows[rows.indexOf(document.activeElement as HTMLButtonElement) + step]?.focus();
}

/** The one pick-from-a-list dialog, reused for every table/analysis/graph choice.
 *  Picking only reports the choice: the owner closes it or moves to the next step.
 *  As a macOS list: one row highlighted, the first at opening (the dialog focuses it),
 *  moved by ↑↓ or the pointer; Return or a click picks it. With `detail`, the list sits
 *  on the left and the highlighted row's detail on the right. */
export function UniversalModal<T extends string>({
  open,
  title,
  description,
  options,
  detail,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  options: SelectorOption<T>[];
  detail?: (value: T) => React.ReactNode;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = React.useState<T>();
  const list = (
    <ul className={cn("flex flex-col gap-0.5", detail ? "-ml-2 w-40 shrink-0" : "-mx-2")} onKeyDown={moveFocus}>
      {options.map((opt) => (
        <li key={opt.value}>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left text-regular outline-none focus:bg-accent focus:text-white"
            onMouseMove={(e) => e.currentTarget.focus()}
            onFocus={() => setShown(opt.value)}
            onClick={() => onSelect(opt.value)}
          >
            {opt.label}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {detail ? (
        <div className="flex gap-4">
          {list}
          {/* Every detail in the same cell, the highlighted one visible: the tallest sets the
              height, so the dialog never jumps as the highlight moves. */}
          <div className="grid flex-1 border-l border-separator pl-4">
            {options.map((opt) => (
              <div
                key={opt.value}
                className={cn("[grid-area:1/1]", opt.value !== (shown ?? options[0]?.value) && "invisible")}
              >
                {detail(opt.value)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        list
      )}
    </Dialog>
  );
}
