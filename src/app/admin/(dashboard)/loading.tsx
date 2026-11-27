/**
 * Shown instantly while an admin page loads, in the shape of a typical page
 * (title, figures, a panel), so moving between pages never shows a blank screen.
 */
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-200/70 motion-reduce:animate-none ${className}`} />;
}

export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2.5">
        <Bar className="h-7 w-64" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-surface shadow-panel sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="space-y-3 border-zinc-200 px-5 py-4 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 sm:[&:nth-child(even)]:border-l">
            <Bar className="h-3 w-28" />
            <Bar className="h-7 w-16" />
            <Bar className="h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-zinc-200 bg-surface shadow-panel">
        <div className="border-b border-zinc-200 px-4 py-3">
          <Bar className="h-4 w-48" />
        </div>
        <div className="space-y-3 px-4 py-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <Bar key={index} className={index % 2 ? "h-4 w-4/5" : "h-4 w-3/5"} />
          ))}
        </div>
      </div>
    </div>
  );
}
