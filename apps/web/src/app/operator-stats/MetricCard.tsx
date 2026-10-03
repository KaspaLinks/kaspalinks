export function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <article className="metric-card metric-card-balanced">
      <span className="metric-label">{label}</span>
      <p className="metric-value">{value}</p>
      <p className="metric-delta metric-delta-muted">{detail}</p>
    </article>
  );
}
