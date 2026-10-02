"use client";

const Arrow = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

// Wise-style pill button: label on the left, arrow in a red circle that slides on hover
// and flies in a loop while processing. Usable as a form submit.
export function ArrowCTA({
  label, processingLabel, processing = false, type = "button", disabled, onClick,
}: {
  label: string;
  processingLabel?: string;
  processing?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`arrow-cta${processing ? " processing" : ""}`}
      type={type} disabled={disabled} onClick={onClick}
      aria-busy={processing || undefined}
    >
      <span className="arrow-cta-label">{processing ? (processingLabel ?? label) : label}</span>
      <span className="arrow-cta-circle"><span className="arrow-cta-glyph"><Arrow /></span></span>
    </button>
  );
}

// Big looping arrow used on the processing screen — a moving focal point while the AI works.
export function ArrowHero() {
  return (
    <div className="arrow-hero" aria-hidden="true">
      <span className="arrow-hero-circle"><span className="arrow-hero-glyph"><Arrow size={40} /></span></span>
    </div>
  );
}
