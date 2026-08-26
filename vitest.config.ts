import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Die Datenbanktests teilen sich eine Verbindung und arbeiten mit
    // Transaktionen, die zurueckgerollt werden. Parallele Prozesse wuerden
    // sich dabei gegenseitig die Sichtbarkeit verstellen.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30_000,
  },
})
