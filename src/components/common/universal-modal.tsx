import type * as React from "react";
import { Dialog } from "../../ui/dialog";

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
 *  moved by ↑↓ or the pointer; Return or a click picks it. */
export function UniversalModal<T extends string>({
  open,
  title,
  description,
  options,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  options: SelectorOption<T>[];
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <ul className="-mx-2 flex flex-col gap-0.5" onKeyDown={moveFocus}>
        {options.map((opt) => (
          <li key={opt.value}>
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-regular outline-none focus:bg-accent focus:text-white"
              onMouseMove={(e) => e.currentTarget.focus()}
              onClick={() => onSelect(opt.value)}
            >
              {opt.label}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
