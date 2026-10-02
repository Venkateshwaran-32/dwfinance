"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteStatementAction } from "@/app/actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn stmt-del-yes" disabled={pending}>{pending ? "Deleting..." : "Delete"}</button>;
}

// Two-step inline confirm (no browser dialog). The server action re-checks ownership.
export function DeleteStatementButton({ statementId, label, count }: { statementId: string; label: string; count: number }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" className="btn ghost stmt-del" onClick={() => setAsking(true)}>Delete statement</button>;
  }
  return (
    <form action={deleteStatementAction} className="stmt-del-confirm" role="group" aria-label={`Confirm deleting ${label}`}>
      <input type="hidden" name="statementId" value={statementId} />
      <span>Delete {label} and its {count} transactions? Your category rules are kept, and you can upload it again any time.</span>
      <ConfirmButton />
      <button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
    </form>
  );
}
