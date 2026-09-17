import type { EscrowTimelineState, EscrowTimelineStep } from "../_lib/escrow-status";

const STATE_TEXT: Record<EscrowTimelineState, string> = {
  attention: "Needs attention",
  current: "In progress",
  done: "Done",
  skipped: "Skipped",
  upcoming: "Not yet",
};

export function EscrowTimeline({ steps }: { steps: EscrowTimelineStep[] }) {
  return (
    <ol className="escrow-timeline">
      {steps.map((step) => (
        <li
          aria-current={step.state === "current" ? "step" : undefined}
          className={`escrow-timeline-step escrow-timeline-${step.state}`}
          key={step.id}
        >
          <span aria-hidden="true" className="escrow-timeline-marker">
            {step.state === "done" ? "✓" : step.state === "attention" ? "!" : ""}
          </span>
          <span className="escrow-timeline-label">{step.label}</span>
          <span className="escrow-sr-only">: {STATE_TEXT[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}
