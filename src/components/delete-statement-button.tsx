"use client";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteStatementAction } from "@/app/actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn stmt-del-yes" disabled={pending}>{pending ? "Deleting..." : "Delete"}</button>;
}

// Two-step inline confirm (no browser dialog). The server action re-checks ownership.
// Sits beside a statement's <summary> (not inside it), so pressing it never opens or closes the row; the
// confirm question covers that row until answered. Focus moves to Cancel, and back to Delete afterwards.
export function DeleteStatementButton({ statementId, label, count }: { statementId: string; label: string; count: number }) {
  const [asking, setAsking] = useState(false);
  const opened = useRef(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) { opened.current = true; cancelRef.current?.focus(); }
    else if (opened.current) deleteRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button ref={deleteRef} type="button" className="btn ghost stmt-del" aria-label={`Delete the ${label} statement`} onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  }
  return (
    <form
      action={deleteStatementAction}
      className="stmt-del-confirm"
      role="group"
      aria-label={`Confirm deleting ${label}`}
      onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }}
    >
      <input type="hidden" name="statementId" value={statementId} />
      <span>Delete {label} and its {count} transactions? Your category rules are kept, and you can upload it again any time.</span>
      <ConfirmButton />
      <button ref={cancelRef} type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
    </form>
  );
}
