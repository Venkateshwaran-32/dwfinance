"use client";
import "@/styles/upload.css";
import { useRef, useState } from "react";
import Link from "next/link";
import { CompoundCalculator } from "@/components/compound-calculator";
import { ArrowCTA, ArrowHero } from "@/components/arrow-cta";
import { useUpload } from "@/components/upload-provider";

const MAX_BYTES = 10 * 1024 * 1024;
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const STEPS = [
  { title: "Read", text: "The text is pulled out of the PDF and every transaction is found. A DBS or POSB statement takes about a second." },
  { title: "Checked", text: "The running balance must match the bank's closing total, so nothing is missed or misread." },
  { title: "Sorted", text: "Each payment goes into a category. Anything uncertain waits in Review for one tap from you." },
  { title: "Private", text: "Everything happens on this computer. The PDF is deleted after reading; only the transactions are kept." },
];

export default function UploadPage() {
  const { status, elapsed, error, warning, fileName, start, reset } = useUpload();
  const [localErr, setLocalErr] = useState("");
  const [picked, setPicked] = useState<{ name: string; bytes: number } | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = status === "uploading";

  function accept(file: File | undefined | null) {
    if (!file) { setPicked(null); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setLocalErr("That is not a PDF. Choose your statement PDF."); setPicked(null); return; }
    if (file.size > MAX_BYTES) { setLocalErr("That file is over 10 MB. Statements are usually well under 1 MB."); setPicked(null); return; }
    setLocalErr("");
    setPicked({ name: file.name, bytes: file.size });
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    if (uploading || !e.dataTransfer.files.length || !inputRef.current) return;
    inputRef.current.files = e.dataTransfer.files; // hand the dropped file to the real input so the form submits it
    accept(e.dataTransfer.files[0]);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) { setLocalErr("Choose a PDF first."); return; }
    setLocalErr("");
    start(form, file.name);
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="upload">
      <section className="upload-hero">
        <div className="upload-copy">
          <h1 className="display-xl">
            Drop your<br />statement.<br /><span className="hl">See everything.</span>
          </h1>
          <p className="upload-lede">
            Add a DBS or POSB statement PDF and every transaction is read, checked and sorted on this computer, in about a second.
            Statements from other banks are read by the local AI and can take a few minutes.
          </p>
        </div>

        <div className="upload-side">
          {status === "done" ? (
            <div className="card upload-card upload-state" role="status">
              <span className={`upload-pill ${warning ? "warn" : "done"}`}>{warning ? "Saved, needs checking" : "Done"}</span>
              <strong className="upload-state-title">Your statement is in</strong>
              {warning ? <p className="upload-warning">{warning}</p> : <p>Every line was checked against the statement&apos;s balance.</p>}
              <div className="upload-actions">
                <Link href="/dashboard" className="btn">View dashboard</Link>
                <Link href="/dashboard/statements" className="btn ghost">See the statement</Link>
                <button type="button" className="btn ghost" onClick={() => { reset(); setPicked(null); }}>Upload another</button>
              </div>
            </div>
          ) : uploading ? (
            <div className="card upload-card upload-state" role="status" aria-live="polite">
              <ArrowHero />
              <strong className="upload-state-title">Reading your money <span className="amount upload-timer">{mmss}</span></strong>
              <div className="progress" role="progressbar" aria-label="Processing"><i /></div>
              <p>
                {fileName ? <span className="upload-file-name">{fileName}</span> : "Your statement"} is being read.
                DBS and POSB statements finish in a moment; other banks can take a few minutes. You can leave this page and it keeps going.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="card upload-card">
              <label
                className={`upload-drop${over ? " over" : ""}${picked ? " has-file" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <input ref={inputRef} className="upload-input" type="file" name="file" accept="application/pdf,.pdf" required onChange={(e) => accept(e.target.files?.[0])} />
                <span className="upload-drop-icon" aria-hidden="true" />
                {picked ? (
                  <>
                    <strong className="upload-file-name">{picked.name}</strong>
                    <span className="upload-drop-hint">{size(picked.bytes)} · click to choose a different file</span>
                  </>
                ) : (
                  <>
                    <strong>Drag your statement PDF here</strong>
                    <span className="upload-drop-hint">or click to choose a file · PDF, up to 10 MB</span>
                  </>
                )}
              </label>
              {(localErr || status === "error") && <p role="alert" className="upload-error">{localErr || error}</p>}
              <ArrowCTA type="submit" label="Upload & categorize" processingLabel="Reading..." />
            </form>
          )}
        </div>
      </section>

      <section aria-labelledby="upload-how">
        <h2 id="upload-how" className="card-title upload-h2">What happens to your statement</h2>
        <ol className="upload-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card card-pad upload-step">
              <span className="upload-step-n" aria-hidden="true">{i + 1}</span>
              <strong>{s.title}</strong>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <CompoundCalculator title="Compound interest calculator" />
    </div>
  );
}
