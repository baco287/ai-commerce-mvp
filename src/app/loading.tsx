import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";

// Suspense-Grenze für alle Seiten: Seiten, die lokale Laufzeitdaten (.data/) lesen, rendern je Anfrage
// (`await connection()`) und werden nie beim Build vorgerendert. Bis dahin zeigt die Kontrollzentrale diesen Hinweis.
export default function Loading() {
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm text-muted">
        <RefreshCw className="size-4 animate-spin text-accent" aria-hidden /> Lade lokale Daten …
      </p>
    </Card>
  );
}
