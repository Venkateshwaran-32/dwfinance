"use client";
import Link from "next/link";
import { useUpload } from "./upload-provider";

// Global pill shown in the nav while an upload runs (on any dashboard page) and when it finishes.
export function UploadIndicator() {
  const { status, elapsed } = useUpload();
  if (status !== "uploading" && status !== "done") return null;

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  if (status === "uploading") {
    return (
      <Link href="/dashboard/upload" className="upload-pill" aria-live="polite">
        <span className="upload-pill-dot" /> Reading... <span className="mono">{mmss}</span>
      </Link>
    );
  }
  return (
    <Link href="/dashboard" className="upload-pill done" aria-live="polite">
      Statement ready
    </Link>
  );
}
