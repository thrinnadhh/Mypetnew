export default function ProviderReviewPage() {
  return (
    <section className="card" aria-labelledby="provider-heading">
      <h2 id="provider-heading">Provider review</h2>
      <p className="muted">The review queue loads only after an ADMIN session with PROVIDER_REVIEW. Verification evidence is private and accessed through short-lived backend-authorized links.</p>
      <p role="status">No authenticated provider review session is active.</p>
    </section>
  )
}

