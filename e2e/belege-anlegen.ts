/**
 * Dem Seed echte Dateien geben.
 *
 * Der Seed ist reine Datenbank: Belege, Läufe, Aufgaben — aber keine einzige
 * Datei. Für die Regeltests unter `tests/` ist das richtig, dort geht es um
 * Zeilen. Im Browser fällt es sofort auf: Der Viewer zeigt ein kaputtes Bild,
 * der PDF-Download antwortet mit 404, und die externe Einsicht liefert nichts.
 *
 * Deshalb bekommen zwei Seed-Belege hier ein echtes PDF und durchlaufen die
 * **gewöhnliche** Aufbereitung — dieselbe, die der Worker fährt. Nichts wird
 * abgekürzt: Seitentext, Vorschaubilder und die freien Stempelplätze
 * entstehen so, wie sie im Betrieb entstehen.
 *
 * Ein Beleg wird dabei **nicht** angefasst: `D3` bleibt ohne Datei. Auch das
 * gibt es im Betrieb — ein Beleg aus einer Altübernahme —, und die Oberfläche
 * soll das aushalten, ohne sich zu verschlucken.
 */

import { rm } from 'node:fs/promises'
import { DateisystemAblage, inhaltHash } from '../src/ablage'
import { alsBenutzer } from '../src/db'
import { aufbereiten } from '../src/worker/aufbereitung'
import { pdfBauen, rechnungsvorlage, type Seitenvorlage } from '../tests/hilfe/pdf-bauen'

/** Muss zu `DMS_ABLAGE` in `playwright.config.ts` passen. */
export const ABLAGE_WURZEL = '.ablage-e2e'

const ANNA = '20000000-0000-0000-0000-000000000001'

/** Die Belege, die eine Datei bekommen. */
const MIT_DATEI: Array<{ id: string; praefix: string; seiten: Seitenvorlage[] }> = [
  {
    id: '70000000-0000-0000-0000-000000000001',
    praefix: 'nord/42/2026/d1',
    seiten: rechnungsvorlage(),
  },
  {
    id: '70000000-0000-0000-0000-000000000004',
    praefix: 'nord/42/2026/d4',
    seiten: [
      {
        zeilen: [
          'Stadtwerke Musterstadt, Versorgungsweg 2, 00000 Musterstadt',
          'Abschlagsrechnung AR-2026-0044 vom 02.05.2026',
          'Objekt 42, Allgemeinstrom, Leistungszeitraum Mai 2026',
          'Netto 168,07 EUR zuzueglich 19 Prozent Umsatzsteuer',
        ],
      },
    ],
  },
]

export async function belegeAnlegen(): Promise<void> {
  // Die Ablage des letzten Laufs wegraeumen: Sonst liegen dort mit jedem
  // Durchgang mehr Vorschaubilder, und niemand raeumt sie je auf.
  await rm(ABLAGE_WURZEL, { force: true, recursive: true })
  const ablage = new DateisystemAblage(ABLAGE_WURZEL)

  for (const beleg of MIT_DATEI) {
    const pdf = await pdfBauen(beleg.seiten)
    const schluessel = `${beleg.praefix}/original.pdf`
    await ablage.schreiben(schluessel, pdf)

    await alsBenutzer(ANNA, async (c) => {
      /*
       * Die Datei an den bestehenden Beleg haengen, statt einen neuen
       * aufzunehmen. So bleiben Lauf, Aufgaben und Kontierung des Seeds
       * erhalten -- und der Beleg, den der Stempeltest kennt, ist derselbe,
       * den der Viewertest oeffnet.
       */
      await c.query(
        `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
         values ($1, 'original', $2, 'application/pdf', $3)
         on conflict do nothing`,
        [beleg.id, schluessel, pdf.byteLength],
      )
      await c.query('update dokument set inhalt_hash = $2 where id = $1', [
        beleg.id,
        inhaltHash(pdf),
      ])

      // Ohne Texterkennung -- der Beleg hat einen Textlayer, und der Test
      // soll die Anwendung sehen, wie sie frisch installiert ist.
      await aufbereiten(c, ablage, beleg.id, null)
    })
  }
}
