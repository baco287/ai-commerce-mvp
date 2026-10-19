import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <p className="text-sm font-medium text-cyan-300">404</p>
      <h1 className="mt-2 text-xl font-semibold">Seite nicht gefunden</h1>
      <p className="mt-1 text-sm text-muted">Dieser Bereich existiert (noch) nicht.</p>
      <Link href="/" className="mt-6 rounded-lg border border-line-strong bg-surface-2 px-4 py-2 text-sm hover:border-cyan-400/40">
        Zum Dashboard
      </Link>
    </div>
  );
}
