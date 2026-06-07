"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function SubmitButton({
  label,
  className = "btn-primary",
}: {
  label: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

export function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Capture the triggering element during the first render — before the dialog's
  // autoFocus runs in commit — so we can return focus to it on close.
  if (openerRef.current === null && typeof document !== "undefined") {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  const titleId = useId();

  useEffect(() => {
    const node = dialogRef.current;

    // Move focus into the dialog (respect an autoFocus'd field if present).
    if (node && !node.contains(document.activeElement)) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (items.length === 0) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Return focus to whatever opened the dialog, if it's still in the DOM.
      const opener = openerRef.current;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="animate-dialog w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface FormDialogProps {
  triggerLabel: ReactNode;
  triggerClassName?: string;
  title: string;
  submitLabel?: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  /** Hidden fields rendered into the form (e.g. ids). */
  hidden?: Record<string, string>;
}

/**
 * A button that opens a modal with a server-action form. Closes on success and
 * surfaces the action's error message. The inner form is remounted on each open
 * (via `key`) so the action state resets cleanly.
 */
export function FormDialog({
  triggerLabel,
  triggerClassName = "btn-secondary",
  title,
  submitLabel = "Save",
  action,
  children,
  hidden,
}: FormDialogProps) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);

  return (
    <>
      <button
        className={triggerClassName}
        onClick={() => {
          setInstance((n) => n + 1);
          setOpen(true);
        }}
      >
        {triggerLabel}
      </button>
      {open && (
        <Overlay title={title} onClose={() => setOpen(false)}>
          <DialogForm
            key={instance}
            action={action}
            submitLabel={submitLabel}
            hidden={hidden}
            onSuccess={() => setOpen(false)}
          >
            {children}
          </DialogForm>
        </Overlay>
      )}
    </>
  );
}

function DialogForm({
  action,
  submitLabel,
  hidden,
  onSuccess,
  children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  submitLabel: string;
  hidden?: Record<string, string>;
  onSuccess: () => void;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, { ok: false });

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      {hidden &&
        Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
