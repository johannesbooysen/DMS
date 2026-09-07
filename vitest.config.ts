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
    /*
     * Vitest 5 schlaegt am Ende jedes Laufs `isolate: false` vor und
     * verspricht rund acht Sekunden von neunzig. **Bewusst nicht gemacht.**
     *
     * Ohne Isolierung teilen sich die Testdateien den Modulzustand -- also
     * denselben Verbindungspool aus `src/db.ts` und dieselben
     * Umgebungsvariablen. Mehrere Dateien schliessen den Pool in `afterAll`
     * (`poolSchliessen`) und setzen `process.env` in `afterEach` zurueck;
     * das ist heute richtig, weil jede Datei fuer sich laeuft. Geteilt
     * wuerde daraus eine Reihenfolgeabhaengigkeit, und die zeigt sich nicht
     * als roter Test, sondern als einer, der manchmal gruen ist.
     *
     * Acht Sekunden sind kein Preis dafuer. Ausserdem gilt die Projektregel:
     * vor einer Optimierung messen -- und gemessen ist hier nur der Gewinn,
     * nicht das Risiko.
     */
    hookTimeout: 30_000,
  },
})
