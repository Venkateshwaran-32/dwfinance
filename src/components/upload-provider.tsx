"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "uploading" | "done" | "error";

type UploadCtx = {
  status: Status;
  elapsed: number;
  error: string;
  fileName: string;
  start: (form: FormData, fileName: string) => void;
  reset: () => void;
};

const Ctx = createContext<UploadCtx | null>(null);

export function useUpload(): UploadCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUpload must be used within <UploadProvider>");
  return c;
}

type JobDTO = { id: string; status: "processing" | "done" | "error"; fileName: string; error: string | null; count: number | null; startedAt: string; finishedAt: string | null };

// Owns the upload lifecycle. The job is tracked SERVER-SIDE (UploadJob), so this resumes
// progress on mount — surviving navigation, full refresh, and logout/login.
export function UploadProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const startMs = useRef<number | null>(null);
  const jobId = useRef<string | null>(null);

  // tick elapsed from the server-known start time while processing
  useEffect(() => {
    if (status !== "uploading") return;
    const t = setInterval(() => {
      if (startMs.current) setElapsed(Math.max(0, Math.floor((Date.now() - startMs.current) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  // poll the server job while processing
  useEffect(() => {
    if (status !== "uploading") return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/upload/status", { cache: "no-store" });
        if (!res.ok) return;
        const { job } = (await res.json()) as { job: JobDTO | null };
        if (!alive || !job) return;
        if (jobId.current && job.id !== jobId.current) return; // a different (older) job
        if (job.status === "done") { setStatus("done"); router.refresh(); }
        else if (job.status === "error") { setStatus("error"); setError(job.error ?? "Upload failed."); }
      } catch { /* transient */ }
    };
    const t = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [status, router]);

  // on mount: resume if the server says a job is still processing
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/upload/status", { cache: "no-store" });
        if (!res.ok) return;
        const { job } = (await res.json()) as { job: JobDTO | null };
        if (!alive || !job || job.status !== "processing") return; // finished jobs aren't nagged on login
        jobId.current = job.id;
        startMs.current = new Date(job.startedAt).getTime();
        setFileName(job.fileName);
        setElapsed(Math.max(0, Math.floor((Date.now() - startMs.current) / 1000)));
        setStatus("uploading");
      } catch { /* offline */ }
    })();
    return () => { alive = false; };
  }, []);

  function start(form: FormData, name: string) {
    if (status === "uploading") return; // one upload at a time
    setError(""); setElapsed(0); setFileName(name);
    startMs.current = Date.now();
    setStatus("uploading");
    fetch("/api/upload", { method: "POST", body: form })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 202 && data.jobId) { jobId.current = data.jobId; return; } // job started; polling takes over
        if (!res.ok) { setStatus("error"); setError(data.error ?? "Upload failed."); }
      })
      .catch(() => { setStatus("error"); setError("Network error — try again."); });
  }

  function reset() {
    if (status === "uploading") return;
    jobId.current = null; startMs.current = null;
    setStatus("idle"); setError(""); setElapsed(0); setFileName("");
  }

  return <Ctx.Provider value={{ status, elapsed, error, fileName, start, reset }}>{children}</Ctx.Provider>;
}
