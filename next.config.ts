import type { NextConfig } from 'next'

const konfiguration: NextConfig = {
  // pdfjs und die Zeichenflaeche gehoeren in den Worker, nicht in den
  // Serverbuild der Anwendung. Sie werden nur dort geladen, wo sie hingehoeren.
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist', 'pg', 'pg-boss'],

  experimental: {
    /*
     * **Der Upload laeuft ueber eine Server Action, und die ist auf 1 MB
     * begrenzt** (Vorgabe von Next, nachgesehen in
     * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`).
     *
     * Das faellt in der Entwicklung nicht auf: Die Seed-Belege und die
     * PDFs der E2E-Tests sind Kilobytes gross. Ein eingescanntes
     * Rechnungsblatt ist es nicht, ein Stapelscan erst recht nicht -- der
     * erste echte Beleg waere an einer Grenze gescheitert, die niemand
     * gesetzt hat.
     *
     * 64 MB und nicht mehr: Der Rumpf einer Server Action liegt waehrend
     * der Uebertragung im Speicher, und der Webcontainer hat 2 GB
     * (`compose.yaml`). Wer regelmaessig groessere Stapel einliest, hebt
     * beides zusammen an -- und die Grenze im `Caddyfile` gleich mit, die
     * absichtlich etwas darueber liegt, damit die Anwendung ablehnt und
     * nicht der Reverse Proxy.
     */
    serverActions: {
      bodySizeLimit: '64mb',
    },
  },
}

export default konfiguration
