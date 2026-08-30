import type { NextConfig } from 'next'

const konfiguration: NextConfig = {
  // pdfjs und die Zeichenflaeche gehoeren in den Worker, nicht in den
  // Serverbuild der Anwendung. Sie werden nur dort geladen, wo sie hingehoeren.
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist', 'pg', 'pg-boss'],
}

export default konfiguration
