// Modal dialog on the native <dialog> element: focus trapping, Esc and the
// backdrop come from the browser engine. A dialog that can be dismissed has a
// Cancel button, before its other buttons, as on macOS; Return presses its default one.
import * as React from "react";
import { Button, Input } from "./controls";

interface DialogProps {
  open: boolean;
  /** Omit to make the dialog impossible to dismiss (e.g. while a task runs). */
  onClose?: () => void;
  /** Its default button's action, which Return presses too, as on macOS. */
  onReturn?: () => void;
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

export function Dialog({ open, onClose, onReturn, title, description, footer, children }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault(); // `open` stays the single source of truth
        onClose?.();
      }}
      onKeyDown={(e) => {
        // A focused button takes Return itself (Cancel cancels).
        if (!onReturn || e.key !== "Enter" || e.nativeEvent.isComposing) return;
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        onReturn();
      }}
      className="m-auto w-[460px] rounded-xl bg-surface p-5 text-primary shadow-2xl ring-1 ring-separator"
    >
      {open && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-large-strong">{title}</h2>
            {description && <p className="text-regular text-secondary">{description}</p>}
          </div>
          {children}
          {(onClose || footer) && (
            <div className="flex justify-end gap-2">
              {onClose && <Button onClick={onClose}>Cancel</Button>}
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Asks for a new name (renaming things). Return confirms. */
export function RenameDialog({
  open,
  initialValue,
  onConfirm,
  onClose,
}: {
  open: boolean;
  initialValue: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  React.useEffect(() => setValue(initialValue), [initialValue, open]);

  const confirm = () => {
    if (value.trim()) onConfirm(value.trim());
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onReturn={confirm}
      title="Rename"
      footer={
        <Button variant="accent" onClick={confirm}>
          Rename
        </Button>
      }
    >
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}
