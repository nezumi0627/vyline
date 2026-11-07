import { cn } from "@/lib/utils";

type ActionFeedbackProps = {
  error?: string | null;
  status?: string | null;
  className?: string;
};

/** Stable-height, accessible feedback slot for user-triggered actions. */
export function ActionFeedback({ error, status, className }: ActionFeedbackProps) {
  return (
    <div
      className={cn("min-h-10 pt-1 text-xs leading-relaxed", className)}
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {error ? (
        <p role="alert" className="break-words text-[var(--vy-danger)]">
          {error}
        </p>
      ) : status ? (
        <p role="status" className="break-words text-[var(--vy-text-dim)]">
          {status}
        </p>
      ) : (
        <span className="sr-only" />
      )}
    </div>
  );
}
