"use client"; // error boundaries must be client components (they receive reset())

import "@/styles/review.css";

export default function ReviewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="review">
      <div className="review-head"><h1>Review</h1></div>
      <div className="card card-pad" role="alert">
        <h2 className="card-title">Could not load your review list</h2>
        <p className="card-sub">Nothing was changed. Try again in a moment.</p>
        <button className="btn ghost review-retry" type="button" onClick={reset}>Try again</button>
      </div>
    </section>
  );
}
