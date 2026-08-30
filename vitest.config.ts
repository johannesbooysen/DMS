import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Derselbe Alias wie in tsconfig.json und in Next: Der Anwendungscode
    // benutzt ihn, damit Turbopack die Importe aufloest -- die Tests muessen
    // dieselben Dateien finden.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Die Datenbanktests teilen sich eine Verbindung und arbeiten mit
    // Transaktionen, die zurueckgerollt werden. Parallele Prozesse wuerden
    // sich dabei gegenseitig die Sichtbarkeit verstellen.
    pool: 'forks',
    fileParallelism: false,
    hookTimeout: 30_000,
  },
})
