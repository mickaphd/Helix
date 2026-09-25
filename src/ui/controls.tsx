// Form controls. Thin wrappers over native HTML elements, so they get
// macOS behavior for free (native <select> popups, keyboard, accessibility).
import type * as React from "react";

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const BUTTON = {
  default: "bg-control hover:bg-separator",
  accent: "bg-accent text-white hover:brightness-110",
  ghost: "hover:bg-control active:bg-separator",
};

// Sizes are props, not classes: two classes for the same property (px-3 and px-0) don't
// override each other by their order in `className`, so the result would be a guess.
const SIZE = {
  regular: "h-7 px-3 text-regular",
  small: "h-5 px-1.5 text-small", // an inline action, like a section's Reset
  icon: "size-6", // a square holding one icon
};

export function Button({
  variant = "default",
  size = "regular",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: keyof typeof BUTTON; size?: keyof typeof SIZE }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md disabled:opacity-40",
        SIZE[size],
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Borderless toolbar button holding a single icon, sized and weighted like an SF Symbol.
 *  Its `aria-label` is also its tooltip. */
export const IconButton = ({ className, ...props }: React.ComponentProps<"button">) => (
  <button
    type="button"
    title={props["aria-label"]}
    className={cn(
      "inline-flex size-7 items-center justify-center rounded-md text-secondary disabled:opacity-40 [&_svg]:size-[18px] [&_svg]:stroke-[1.75]",
      BUTTON.ghost,
      className,
    )}
    {...props}
  />
);

const FIELD = "h-7 w-full rounded-md bg-control px-2 text-regular outline-none focus:ring-2 focus:ring-accent";

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input className={cn(FIELD, className)} {...props} />
);

/** A number field whose value is `null` while empty or invalid. */
export function NumberInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      type="number"
      className={FIELD}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" || isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber)}
      {...props}
    />
  );
}

export function Checkbox({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      className={cn("size-3.5 accent-accent", className)}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** A checkbox drawn as an on/off switch. */
export function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="relative h-4 w-7 shrink-0 cursor-pointer appearance-none rounded-full bg-separator transition-colors checked:bg-accent before:absolute before:top-0.5 before:left-0.5 before:size-3 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-3"
    />
  );
}

interface Option<T extends string = string> {
  value: T;
  label: React.ReactNode;
}

/** A vertical list of radio buttons. */
export function RadioList<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
}) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-regular">
          <input
            type="radio"
            className="accent-accent"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Native popup menu. `placeholder` adds an empty first entry (value ""). */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | "";
  onChange: (value: T) => void;
  options: Option<T>[];
  placeholder?: string;
}) {
  return (
    <select className={FIELD} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Mutually exclusive buttons in one pill (macOS segmented control). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
}) {
  return (
    <div className="flex rounded-md bg-control p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 flex-1 rounded-[5px] px-2 text-small",
            value === o.value && "bg-surface text-primary shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A label on the left, its control on the right. */
export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex items-center justify-between gap-4 text-regular">
    {label}
    <div className="w-40">{children}</div>
  </label>
);
