import "@/styles/review.css";

// Skeleton while the review queue is grouped on the server.
export default function ReviewLoading() {
  return (
    <section className="review" aria-busy="true" aria-label="Loading payees to review">
      <div className="review-head"><h1>Review</h1></div>
      <ol className="review-list">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="card card-pad review-group review-skel">
            <div className="review-who"><span className="skel skel-title" /><span className="skel skel-line" /></div>
            <div className="review-form"><span className="skel skel-input" /></div>
          </li>
        ))}
      </ol>
    </section>
  );
}
