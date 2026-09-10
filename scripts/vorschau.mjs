/**
 * Startet die Anwendung so, dass ein Mensch sie ansehen kann.
 *
 * WARUM ES DAS BRAUCHT
 *
 * Die Entwicklungsanmeldung verlangt `DMS_ANMELDUNG=entwicklung`. Diese
 * Variable stand bis hierher an genau **einer** Stelle im Repository: in
 * `playwright.config.ts`. Die Oberflaeche war damit ausschliesslich
 * waehrend eines E2E-Laufs erreichbar -- wer `npm run dev` startete, landete
 * auf einer Anmeldeseite, an der er nicht vorbeikam, weil kein
 * Entra-Mandant eingerichtet ist.
 *
 * Ein npm-Skript kann die Variable nicht portabel setzen: Unter Windows
 * fuehrt npm die Skripte ueber `cmd` aus, und `VAR=wert befehl` ist dort
 * kein gueltiger Aufruf. Deshalb dieses Skript.
 *
 * KEIN WEG AN ENTRA VORBEI
 *
 * Die Entwicklungsanmeldung verlangt **zusaetzlich** `NODE_ENV !=
 * production` (siehe `src/anmeldung/index.ts`). `next dev` setzt
 * `development`; dieses Skript startet ausschliesslich `next dev` und kann
 * deshalb keinen Produktivbetrieb oeffnen.
 */

import { spawn } from 'node:child_process'

const umgebung = {
  ...process.env,
  DMS_ANMELDUNG: 'entwicklung',
  DMS_SITZUNGS_GEHEIMNIS:
    process.env.DMS_SITZUNGS_GEHEIMNIS ?? 'vorschau-geheimnis-mindestens-zweiunddreissig-zeichen',
  // Dieselbe Ablage wie `npm run dev`, damit ein hochgeladener Beleg auch
  // hier seine Vorschaubilder findet.
  DMS_ABLAGE: process.env.DMS_ABLAGE ?? '.ablage',
}

console.log('Vorschau mit Entwicklungsanmeldung auf http://localhost:3000')
console.log('Anmelden als Anna, Bernd, Clara, Doris oder Eva -- ohne Passwort.')
console.log('Keine Seitenbilder zu sehen? npm run vorschau:befuellen\n')

/*
 * **Web und Worker**, nicht nur Web.
 *
 * Der erste Entwurf startete allein `next dev`. Die Oberflaeche kam damit
 * hoch, aber ein hochgeladener Beleg blieb fuer immer in `in_aufbereitung`:
 * Rendern, Texterkennung und Extraktion laufen im Worker. Eine Vorschau, in
 * der man nichts aufnehmen kann, beantwortet die Frage nicht, fuer die es
 * sie gibt.
 */
const kind = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: umgebung,
  shell: true,
})

kind.on('exit', (code) => process.exit(code ?? 0))
