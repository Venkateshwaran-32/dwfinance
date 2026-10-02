import Link from "next/link";
import { fastAccessAction } from "@/app/actions";
import { fastAccessEnabled } from "@/lib/env";

export default function Home() {
  return (
    <main className="home">
      <p className="home-kicker">dwfinance · built in Singapore</p>
      <h1 className="display-xl home-title">
        Reads DBS and POSB statement PDFs and sorts every transaction on your own computer.
      </h1>
      <p className="home-lede">
        Add a statement PDF, check where the money went, then ask questions in plain English.
        The AI that answers also runs on your computer, so your statements are not sent to a cloud service.
      </p>
      <div className="home-actions">
        {fastAccessEnabled && (
          <form action={fastAccessAction}>
            <button className="btn" type="submit">Fast access</button>
          </form>
        )}
        <Link className={fastAccessEnabled ? "btn ghost" : "btn"} href="/signup">Get started</Link>
        <Link className="btn ghost" href="/login">Log in</Link>
      </div>
      <ul className="home-points">
        <li><strong>Exact, not guessed.</strong> Every amount is checked against the bank&apos;s own closing balance.</li>
        <li><strong>Teach it once.</strong> Tell it who a PayNow payee is and it remembers for every past and future payment.</li>
        <li><strong>Ask anything.</strong> An AI that runs on your computer answers with figures you can trace back to the statement.</li>
      </ul>
    </main>
  );
}
