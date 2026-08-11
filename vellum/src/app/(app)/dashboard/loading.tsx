/** Skeleton shaped like the real library grid. */
export default function DashboardLoading() {
  return (
    <main className="min-h-screen">
      <div
        className="hairline-b material sticky top-0"
        style={{ height: "var(--h-toolbar)", zIndex: 20 }}
      />
      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="skeleton h-7 w-40" />
        <div className="skeleton mt-2 h-4 w-72" />
        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="surface overflow-hidden">
              <div className="skeleton aspect-video rounded-none" />
              <div className="p-3.5">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton mt-2 h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
