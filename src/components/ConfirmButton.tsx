"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

function Inner({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

/**
 * A submit button that posts a server action. If `confirmText` is provided it
 * shows a confirm() guard first; otherwise it submits immediately. Errors are
 * surfaced via an alert.
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
  const [state, formAction] = useActionState(action, { ok: false });

  useEffect(() => {
    if (state.error) window.alert(state.error);
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Inner label={label} className={className} />
    </form>
  );
}
