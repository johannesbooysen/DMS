/**
 * Ende-zu-Ende-Tests.
 *
 * Sie prüfen etwas anderes als die Suite unter `tests/`. Dort geht es um
 * Regeln — RLS, Summenzwang, Hash-Kette —, und dafür ist der Browser der
 * falsche Ort: zu langsam, zu indirekt, und eine Zusicherung über eine
 * Policy lässt sich an einer Oberfläche nicht beweisen.
 *
 * Hier geht es um **die Kette**: dass Anmeldung, Sitzung, RLS, Engine,
 * Server-Aktion und Umleitung zusammen tragen. Jeder Teil davon ist einzeln
 * geprüft; dass sie zusammenpassen, ist es nicht.
 *
 * Deshalb wenige Tests, und jeder geht einen ganzen Weg.
 */

import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const BASIS = 'http://localhost:3100'

export default defineConfig({
  testDir: './e2e',
  // `.spec.ts`, damit Vitest sie nicht aufsammelt: Dort gilt
  // `tests/**/*.test.ts`.
  testMatch: '**/*.spec.ts',

  /*
   * Vor dem Lauf wird die Datenbank neu aufgebaut.
   *
   * Stempeln ist unumkehrbar -- append-only, Hash-Kette. Nach einem
   * Durchlauf ist die Aufgabe erledigt, und ein zweiter Lauf faende sie
   * nicht mehr. Es gibt keinen Rollback wie in den Unit-Tests: Der Browser
   * spricht ueber HTTP, jede Anfrage ist ihre eigene Transaktion.
   *
   * Vierzig Sekunden, die vorne wegfallen. Wenn die Suite so gross wird,
   * dass das stoert, legt jeder Test seinen eigenen Beleg an -- aber nicht
   * vorher: Ein Test, der auf dem Seed arbeitet, ist einer, den man lesen
   * kann.
   */
  globalSetup: fileURLToPath(new URL('./e2e/aufsetzen.ts', import.meta.url)),

  // Reihum, nicht nebeneinander: Alle Tests teilen sich eine Datenbank, und
  // zwei gleichzeitige Stempel auf demselben Beleg waeren ein Wettlauf.
  workers: 1,
  fullyParallel: false,

  // Kein Wiederholen. Ein Test, der beim zweiten Mal gruen wird, hat beim
  // ersten Mal etwas gefunden -- und `db:reset` laeuft ohnehin nur einmal,
  // ein zweiter Versuch traefe also auf veraenderte Daten.
  retries: 0,

  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASIS,
    // Bei einem Fehlschlag will man sehen, was auf dem Schirm stand.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    /*
     * Eigener Port, damit ein nebenher laufender Entwicklungsserver auf 3000
     * nicht mitgetestet wird -- und umgekehrt der Test nicht abbricht, weil
     * jemand gerade 3000 belegt.
     */
    command: 'npm run dev:web -- --port 3100',
    url: `${BASIS}/anmeldung`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      /*
       * Die Entwicklungsanmeldung. Sie verlangt zusaetzlich
       * `NODE_ENV != production` -- `next dev` setzt `development`, es gibt
       * hier also keinen stillen Weg an Entra vorbei.
       */
      DMS_ANMELDUNG: 'entwicklung',
      DMS_SITZUNGS_GEHEIMNIS: 'e2e-geheimnis-mindestens-zweiunddreissig-zeichen',
      // Bewusst **ohne** DMS_OCR, SMTP_URL und DMS_EXTRAKTION: Der Test soll
      // die Anwendung so sehen, wie sie frisch installiert ist.
      DMS_ABLAGE: '.ablage-e2e',
    },
  },
})
