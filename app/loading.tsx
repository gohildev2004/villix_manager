export default function Loading() {
  return (
    <main className="route-loading" aria-label="Loading Villix Manager" aria-busy="true">
      <div className="route-loading-mark skeleton-block" />
      <div className="route-loading-card">
        <div className="skeleton-block skeleton-kicker" />
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-copy" />
        <div className="skeleton-block skeleton-copy short" />
      </div>
    </main>
  );
}
