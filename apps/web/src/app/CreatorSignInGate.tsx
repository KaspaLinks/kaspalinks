import Link from "next/link";

type CreatorSignInGateProps = {
  description: string;
  label: string;
  nextPath: string;
  title: string;
};

export function CreatorSignInGate({ description, label, nextPath, title }: CreatorSignInGateProps) {
  const signInHref = `/sign-in?next=${encodeURIComponent(nextPath)}`;

  return (
    <section className="card card-accent creator-sign-in-gate">
      <span className="label">{label}</span>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
      <div className="row">
        <Link className="btn btn-primary" href={signInHref}>
          Sign in
        </Link>
        <Link className="btn" href="/create-profile">
          Create profile
        </Link>
      </div>
    </section>
  );
}
