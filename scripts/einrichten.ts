/**
 * Ersteinrichtung eines Hauses mit einem Berechtigungs-Preset
 * (Konzept §24.13).
 *
 *   npm run einrichten -- <mandant-id> <weg|miet|se>
 *   npm run einrichten                          # zeigt die Presets
 *
 * WARUM ALS SKRIPT UND NICHT IN DER OBERFLAECHE
 *
 * Presets sollen die Ersteinrichtung tragen -- aber sie anzuwenden verlangt
 * `benutzer_verwalten`, und dieses Recht entsteht erst durch das Preset.
 * Diese Henne faengt dieses Skript ein: Es laeuft als Eigentuemer der
 * Tabellen, ausserhalb der RLS, wie Migration und Seed auch. Ein Haus, das
 * schon Benutzer hat, richtet man dagegen ueber die Oberflaeche ein -- dort
 * greift die Policy, und das ist richtig so.
 *
 * Es nimmt **nichts weg**: Vorhandene Rollen bleiben unveraendert, Rechte
 * kommen hinzu. Zweimal aufrufen ist wie einmal.
 */

import { verbindungspool, poolSchliessen } from '../src/db'
import { PRESETS, anwenden } from '../src/stammdaten/presets'

function uebersicht(): void {
  console.log('Verfuegbare Presets:\n')
  for (const p of PRESETS) {
    console.log(`  ${p.id.padEnd(6)} ${p.name}`)
    console.log(`         ${p.beschreibung.replace(/\s+/g, ' ')}`)
    for (const r of p.rollen) {
      console.log(`         - ${r.kurzcode.padEnd(3)} ${r.name}: ${r.rechte.join(', ')}`)
    }
    console.log()
  }
  console.log('Aufruf: npm run einrichten -- <mandant-id> <preset-id>')
}

async function main(): Promise<void> {
  const [mandantId, presetId] = process.argv.slice(2)
  if (mandantId === undefined || presetId === undefined) {
    uebersicht()
    return
  }

  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query<{ name: string }>('select name from mandant where id = $1', [
      mandantId,
    ])
    const haus = rows[0]?.name
    if (haus === undefined) {
      // Kein Mandantenfilter noetig -- dieses Skript laeuft als Eigentuemer.
      // Genau deshalb wird hier ausdruecklich geprueft, ob es das Haus gibt:
      // ein Tippfehler in der Kennung legte sonst Rollen fuer niemanden an.
      console.error(`Es gibt keinen Mandanten mit der Kennung ${mandantId}.`)
      process.exitCode = 1
      return
    }

    await c.query('begin')
    const bilanz = await anwenden(c, presetId, mandantId)
    await c.query('commit')

    console.log(`Haus: ${haus}`)
    console.log(`Preset: ${presetId}`)
    console.log(`Rollen angelegt:     ${bilanz.rollenAngelegt.join(', ') || '(keine)'}`)
    console.log(`Rollen vorhanden:    ${bilanz.rollenVorhanden.join(', ') || '(keine)'}`)
    console.log(`Rechte angelegt:     ${bilanz.rechteAngelegt}`)
    console.log(`Stempelrechte:       ${bilanz.stempelrechteAngelegt}`)

    /*
     * **Eine Pruefung, die nichts vorfindet, gibt keine Entwarnung.** Fehlen
     * die Stempeltypen, sind die Rollen zwar da, aber niemand kann etwas
     * stempeln -- und das faellt sonst erst auf, wenn der erste Beleg
     * feststeckt.
     */
    if (bilanz.ohneStempeltyp.length > 0) {
      console.warn(
        `\nOhne Stempeltyp geblieben: ${bilanz.ohneStempeltyp.join(', ')}\n` +
          'Zu diesen Kurzcodes gibt es in diesem Haus keinen Stempeltyp, die ' +
          'Zuordnung fehlt also. Stempeltypen anzulegen ist Ablaufkonfiguration ' +
          '(Konzept 8) und geschieht in der Oberflaeche unter Ablaeufe.',
      )
    }
  } catch (fehler) {
    await c.query('rollback').catch(() => undefined)
    throw fehler
  } finally {
    c.release()
  }
}

main()
  .catch((fehler: unknown) => {
    console.error('Einrichtung fehlgeschlagen:', fehler instanceof Error ? fehler.message : fehler)
    process.exitCode = 1
  })
  .finally(poolSchliessen)
