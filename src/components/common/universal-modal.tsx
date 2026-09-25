import { Dialog } from "../../ui/dialog";

export interface SelectorOption<T extends string = string> {
  value: T;
  label: string;
}

/** The one pick-from-a-list dialog, reused for every table/analysis/graph choice.
 *  Picking only reports the choice: the owner closes it or moves to the next step. */
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
      <ul className="-mx-2 flex flex-col gap-0.5">
        {options.map((opt) => (
          <li key={opt.value}>
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-regular outline-none hover:bg-control focus-visible:bg-control"
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
