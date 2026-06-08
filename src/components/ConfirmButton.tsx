"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { Overlay } from "./Dialog";

function ActionSubmit({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Working..." : label}
    </button>
  );
}

function HiddenFields({ hidden }: { hidden: Record<string, string> }) {
  return (
    <>
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}

function InlineActionForm({
  label,
  action,
  hidden,
  className,
}: {
  label: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  className: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false });

  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <HiddenFields hidden={hidden} />
      <ActionSubmit label={label} className={className} />
      {state.error && (
        <span role="alert" className="max-w-64 text-xs text-danger">
          {state.error}
        </span>
      )}
      {state.ok && <span role="status" className="sr-only">Done.</span>}
    </form>
  );
}

function ConfirmDialogForm({
  confirmText,
  action,
  hidden,
  onCancel,
  onSuccess,
}: {
  confirmText: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, { ok: false });

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <HiddenFields hidden={hidden} />
      <p className="text-sm text-muted">{confirmText}</p>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <ActionSubmit label="Confirm" className="btn-danger" />
      </div>
    </form>
  );
}

/**
 * Submit a server action directly or, when confirmText is supplied, require an
 * in-app confirmation dialog. Action errors are rendered inline.
 */
export function ConfirmButton({
  label,
  confirmText,
  action,
  hidden,
  className = "btn-danger",
}: {
  label: string;
  confirmText?: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);

  if (!confirmText) {
    return (
      <InlineActionForm label={label} action={action} hidden={hidden} className={className} />
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setInstance((current) => current + 1);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <Overlay title={label} onClose={() => setOpen(false)}>
          <ConfirmDialogForm
            key={instance}
            confirmText={confirmText}
            action={action}
            hidden={hidden}
            onCancel={() => setOpen(false)}
            onSuccess={() => setOpen(false)}
          />
        </Overlay>
      )}
    </>
  );
}
