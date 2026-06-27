const sections = [
  {
    title: "Realtime Odds",
    description: "Redis-backed current odds cache with collector-driven updates."
  },
  {
    title: "Validation Pipeline",
    description: "Ordered safety checks before any bet request can enter execution."
  },
  {
    title: "Execution Safety",
    description: "Account, fixture, and market locking to prevent race conditions."
  },
  {
    title: "Operational Control",
    description: "Runtime feature switches, audit trail, and alert propagation."
  }
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Surebet Platform</p>
        <h1>Control tower scaffold for realtime detection and safe execution.</h1>
        <p className="intro">
          This frontend is intentionally a thin shell for the architecture phase. It
          maps the platform domains we will wire to REST and websocket streams next.
        </p>
      </section>

      <section className="grid">
        {sections.map((section) => (
          <article className="card" key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

