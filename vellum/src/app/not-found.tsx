export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="surface max-w-md p-6 text-center">
        <h1 className="t-emph font-semibold">Not found</h1>
        <p className="t-body mt-1.5 text-ink-2">
          That document doesn’t exist, or it was deleted.
        </p>
        <a href="/dashboard" className="btn btn-primary mt-5">
          Back to library
        </a>
      </div>
    </main>
  );
}
