export function FloatNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-3">
      <div className="rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface)]/95 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur">
        {children}
      </div>
    </div>
  );
}
