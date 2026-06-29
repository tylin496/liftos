// Temporary placeholder used by every feature page in P0. Each feature replaces
// it with real UI in its own phase (P1 Nutrition, P2 Training, P3/P4 Health/Overview).
export function PageStub({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string;
  title: string;
  note: string;
}) {
  return (
    <div className="page">
      <section className="page-card">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-note">{note}</p>
      </section>
    </div>
  );
}
