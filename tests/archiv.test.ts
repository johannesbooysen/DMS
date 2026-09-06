/**
 * Tests der Archivierung, Aufbewahrung und Einschränkung.
 *
 * Drei Dinge, die auseinandergehalten gehören und hier getrennt geprüft
 * werden:
 *
 *   * **Archiviert** — der Beleg ist fest. Korrektur nur über Storno plus
 *     Neuerfassung. Das erzwingen Trigger, nicht die Anwendung; ein Test
 *     gegen die Anwendung würde die falsche Schicht prüfen.
 *   * **Aufbewahrungsfrist** — die Frist läuft ab dem **Ende** des Jahres.
 *     Wer ab Belegdatum rechnet, löscht zu früh, und das fällt erst bei einer
 *     Betriebsprüfung auf.
 *   * **Eingeschränkt** — ein Löschanspruch an einem aufbewahrungspflichtigen
 *     Beleg führt weder zum Ignorieren noch zum Löschen. Beides wäre ein
 *     Verstoß, nur gegen verschiedene Gesetze.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  archivieren,
  archivstandLaden,
  einschraenken,
  loeschkandidaten,
  objektakteSchreiben,
  objektakteZusammenstellen,
  stornieren,
} from '../src/archiv'
import type { Ablage } from '../src/ablage'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const CLARA = '20000000-0000-0000-0000-000000000003'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const KONTO = '37000000-0000-0000-0000-000000000001'

let beleg = ''

class Merkablage implements Ablage {
  readonly dateien = new Map<string, Buffer>()
  async schreiben(schluessel: string, inhalt: Buffer): Promise<void> {
    this.dateien.set(schluessel, inhalt)
  }
  async lesen(schluessel: string): Promise<Buffer> {
    const treffer = this.dateien.get(schluessel)
    if (treffer === undefined) throw new Error('nicht gefunden')
    return treffer
  }
  async entfernen(schluessel: string): Promise<void> {
    // Eine fehlende Datei ist kein Fehler -- der Loeschdurchgang laeuft
    // ihr wiederholt ueber den Weg.
    this.dateien.delete(schluessel)
  }
}

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/** Legt einen Beleg an. `jahr` steuert das Wirtschaftsjahr. */
async function belegAnlegen(jahr = 2026): Promise<string> {
  return alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto,
                                    wirtschaftsjahr)
       values ($1, $2, 'RE-ARCHIV', current_date, 1000, 190, 1190, $3)`,
      [id, KREDITOR, jahr],
    )
    await c.query(
      `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                               steuersatz, betrag_brutto, umlagefaehig, quelle)
       values ($1, 1, $2, 1000, 19, 1190, true, 'mensch')`,
      [id, KONTO],
    )
    return id
  })
}

beforeEach(async () => {
  beleg = await belegAnlegen()
})

afterEach(async () => {
  await belegEntfernen(beleg)
  await direkt('delete from aufbewahrungsfrist')
})

afterAll(poolSchliessen)

async function archiviereBeleg(): Promise<string | null> {
  return alsBenutzer(ANNA, (c) => archivieren(c, beleg))
}

describe('Aufbewahrungsfrist', () => {
  it('rechnet ab dem Ende des Jahres, nicht ab dem Belegdatum', async () => {
    // Ein Beleg vom 2. Januar und einer vom 30. Dezember desselben Jahres
    // verfallen am selben Tag (Paragraf 147 AO).
    expect(await archiviereBeleg()).toBe('2036-12-31')
  })

  it('nimmt zehn Jahre, wenn nichts hinterlegt ist', async () => {
    const stand = await alsBenutzer(ANNA, async (c) => {
      await archivieren(c, beleg)
      return archivstandLaden(c, beleg)
    })
    // Eine fehlende Konfiguration darf nicht zu einer kuerzeren Frist fuehren.
    expect(stand?.aufbewahrungBis).toBe('2036-12-31')
    expect(stand?.aufbewahrungsgrund).toMatch(/147 AO/)
  })

  it('nimmt die hinterlegte Frist der Belegart', async () => {
    await direkt(
      `insert into aufbewahrungsfrist (mandant_id, belegart, jahre, grund)
       values ($1, 'rechnung', 6, 'Handelsbrief, sechs Jahre')`,
      [MANDANT],
    )
    expect(await archiviereBeleg()).toBe('2032-12-31')
  })

  it('faellt auf das Eingangsjahr zurueck, wenn kein Wirtschaftsjahr steht', async () => {
    await direkt('update rechnung_fakten set wirtschaftsjahr = null where dokument_id = $1', [
      beleg,
    ])
    const jahr = new Date().getFullYear() + 10
    expect(await archiviereBeleg()).toBe(`${jahr}-12-31`)
  })
})

describe('Archivieren', () => {
  it('haelt den Hash der Datei fest', async () => {
    await archiviereBeleg()
    const [zeile] = await direkt<{ hash_sha256: string; inhalt_hash: string }>(
      `select a.hash_sha256, d.inhalt_hash
         from archiv_eintrag a join dokument d on d.id = a.dokument_id
        where a.dokument_id = $1`,
      [beleg],
    )
    // Ohne den Hash waere Object Lock eine Behauptung.
    expect(zeile.hash_sha256).toBe(zeile.inhalt_hash)
  })

  it('setzt den Status auf archiviert', async () => {
    await archiviereBeleg()
    const [d] = await direkt<{ status: string }>('select status from dokument where id = $1', [
      beleg,
    ])
    expect(d.status).toBe('archiviert')
  })

  it('laesst einen abgelehnten Beleg abgelehnt', async () => {
    // Abgelehnte Belege werden archiviert und behalten ihren Status: Der
    // Archiveintrag sagt, dass archiviert wurde, der Status, was aus dem
    // Beleg geworden ist.
    await direkt(`update dokument set status = 'abgelehnt' where id = $1`, [beleg])
    await archiviereBeleg()

    const [d] = await direkt<{ status: string }>('select status from dokument where id = $1', [
      beleg,
    ])
    expect(d.status).toBe('abgelehnt')
    expect(await direkt('select 1 from archiv_eintrag where dokument_id = $1', [beleg]))
      .toHaveLength(1)
  })

  it('archiviert nicht zweimal', async () => {
    await archiviereBeleg()
    await archiviereBeleg()
    expect(await direkt('select 1 from archiv_eintrag where dokument_id = $1', [beleg]))
      .toHaveLength(1)
  })

  it('traegt ohne Object Lock kein Datum ein', async () => {
    // Die Dateisystem-Ablage kann keinen Object Lock. Ein Datum, das nichts
    // bewirkt, ist schlechter als eine leere Spalte -- es sieht aus wie ein
    // Schutz.
    await archiviereBeleg()
    const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
    expect(stand?.objectLockBis).toBeNull()
  })
})

describe('Nach der Archivierung ist Schluss', () => {
  beforeEach(async () => {
    await archiviereBeleg()
  })

  it('laesst den Betrag nicht mehr aendern', async () => {
    await expect(
      direkt('update rechnung_fakten set brutto = 9999 where dokument_id = $1', [beleg]),
    ).rejects.toThrow(/archiviert/)
  })

  it('laesst die Kontierung nicht mehr aendern', async () => {
    await expect(
      direkt('update kontierung set betrag_brutto = 1 where dokument_id = $1', [beleg]),
    ).rejects.toThrow(/archiviert/)
  })

  it('laesst keine Kontierungszeile mehr hinzufuegen', async () => {
    await expect(
      direkt(
        `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                                 steuersatz, betrag_brutto, quelle)
         values ($1, 9, $2, 1, 19, 1, 'mensch')`,
        [beleg, KONTO],
      ),
    ).rejects.toThrow(/archiviert/)
  })

  it('laesst den Beleg nicht umgruppieren', async () => {
    await expect(
      direkt('update dokument set objekt_id = $2 where id = $1', [
        beleg,
        '50000000-0000-0000-0000-000000000043',
      ]),
    ).rejects.toThrow(/Storno/)
  })

  it('laesst ihn nicht loeschen', async () => {
    await expect(direkt('delete from dokument where id = $1', [beleg])).rejects.toThrow(
      /nicht geloescht/,
    )
  })

  it('laesst den Archiveintrag selbst nicht aendern', async () => {
    await expect(
      direkt(`update archiv_eintrag set aufbewahrung_bis = '2027-01-01'
               where dokument_id = $1`, [beleg]),
    ).rejects.toThrow()
  })
})

describe('Storno statt Korrektur', () => {
  it('setzt den Beleg auf storniert und verlangt eine Begruendung', async () => {
    await archiviereBeleg()

    await expect(
      alsBenutzer(ANNA, (c) => stornieren(c, beleg, '   ')),
    ).rejects.toThrow(/Begruendung/)

    const erfolg = await alsBenutzer(ANNA, (c) =>
      stornieren(c, beleg, 'Falscher Kreditor erfasst'),
    )
    expect(erfolg).toBe(true)

    const [d] = await direkt<{ status: string }>('select status from dokument where id = $1', [
      beleg,
    ])
    expect(d.status).toBe('storniert')
  })

  it('verkettet die Ersatzrechnung mit dem Ursprungsbeleg', async () => {
    const ersatz = await belegAnlegen()
    try {
      await archiviereBeleg()
      await alsBenutzer(ANNA, (c) => stornieren(c, beleg, 'Betrag falsch', ersatz))

      const [b] = await direkt<{ art: string }>(
        'select art from dokument_beziehung where von_dokument = $1 and zu_dokument = $2',
        [ersatz, beleg],
      )
      expect(b.art).toBe('ersetzt')
    } finally {
      await belegEntfernen(ersatz)
    }
  })
})

describe('DSGVO gegen GoBD', () => {
  it('loescht nicht, sondern schraenkt bis zum Fristablauf ein', async () => {
    await archiviereBeleg()
    const loeschbarAb = await alsBenutzer(ANNA, (c) =>
      einschraenken(c, beleg, 'Loeschantrag der betroffenen Person'),
    )
    expect(loeschbarAb).toBe('2036-12-31')

    // Der Beleg ist noch da -- er ist nur nicht mehr sichtbar.
    expect(await direkt('select 1 from dokument where id = $1', [beleg])).toHaveLength(1)
  })

  it('entzieht die Leserechte -- auch dem Zustaendigen', async () => {
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))

    const sichtbar = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query('select 1 from dokument where id = $1', [beleg])
      return rows.length
    })
    // Anna ist objektverantwortlich. Wer hier eine Ausnahme einbaut, hebt die
    // Einschraenkung auf.
    expect(sichtbar).toBe(0)
  })

  it('laesst den Nachweis stehen, dass der Antrag bearbeitet wurde', async () => {
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))

    const eintraege = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ grund: string }>(
        'select grund from einschraenkung where dokument_id = $1',
        [beleg],
      )
      return rows
    })
    // Sonst waere der Beleg unsichtbar und der Vorgang spurlos.
    expect(eintraege).toHaveLength(1)
    expect(eintraege[0].grund).toBe('Loeschantrag')
  })

  it('zeigt einen Loeschkandidaten erst nach Fristablauf', async () => {
    await archiviereBeleg()
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))

    const heute = await alsBenutzer(ANNA, (c) => loeschkandidaten(c))
    expect(heute.map((k) => k.dokumentId)).not.toContain(beleg)

    const spaeter = await alsBenutzer(ANNA, (c) => loeschkandidaten(c, '2037-01-01'))
    expect(spaeter.map((k) => k.dokumentId)).toContain(beleg)
  })

  it('haelt ihn trotz Fristablauf, wenn eine Loeschsperre steht', async () => {
    await archiviereBeleg()
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))
    // Laufendes Verfahren: Der Beleg bleibt ueber die Frist hinaus.
    await direkt(
      `update archiv_eintrag set loeschsperre = true,
                                 loeschsperre_grund = 'Laufendes Verfahren'
        where dokument_id = $1`,
      [beleg],
    )

    const spaeter = await alsBenutzer(ANNA, (c) => loeschkandidaten(c, '2037-01-01'))
    expect(spaeter.map((k) => k.dokumentId)).not.toContain(beleg)
  })

  it('zeigt einem fremden Mandanten keine Loeschkandidaten', async () => {
    // `app.loeschkandidaten` ist security definer -- es muss auch die Belege
    // finden, die niemand mehr sehen darf. Genau deshalb steht der
    // Mandantenfilter dort von Hand.
    await archiviereBeleg()
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))

    const fremd = await alsBenutzer('20000000-0000-0000-0000-000000000004', (c) =>
      loeschkandidaten(c, '2037-01-01'),
    )
    expect(fremd.map((k) => k.dokumentId)).not.toContain(beleg)
  })

  it('zeigt einem fremden Mandanten die Einschraenkung nicht', async () => {
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))
    const fremd = await alsBenutzer('20000000-0000-0000-0000-000000000004', async (c) => {
      const { rows } = await c.query('select 1 from einschraenkung where dokument_id = $1', [
        beleg,
      ])
      return rows.length
    })
    expect(fremd).toBe(0)
  })
})

describe('Objektakte für den Verwalterwechsel', () => {
  it('sammelt Beleg, Kontierung und Stempelhistorie', async () => {
    const ablage = new Merkablage()
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, ablage, OBJEKT_42, '2026-08-31'),
    )

    expect(akte).not.toBeNull()
    expect(akte?.objektnummer).toBe('42')

    const meiner = akte?.dokumente.find((d) => d.dokumentId === beleg)
    expect(meiner).toBeDefined()
    const metadaten = meiner?.metadaten as Record<string, unknown>
    expect((metadaten['kontierung'] as unknown[]).length).toBe(1)
    expect(metadaten['beleg']).toMatchObject({ rechnungsnummer: 'RE-ARCHIV' })
  })

  it('benennt Belege ohne Originaldatei, statt sie zu verschweigen', async () => {
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, new Merkablage(), OBJEKT_42, '2026-08-31'),
    )
    // Eine Akte mit einer stillen Luecke ist schlimmer als eine mit einer
    // bekannten.
    expect(akte?.ohneDatei).toContain(beleg)
  })

  it('schreibt ein Manifest, mit dem sich die Akte ohne uns pruefen laesst', async () => {
    const ablage = new Merkablage()
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, ablage, OBJEKT_42, '2026-08-31'),
    )
    const geschrieben = await objektakteSchreiben(ablage, akte!, 'export/objekt-42')

    expect(geschrieben).toContain('export/objekt-42/manifest.txt')
    expect(geschrieben).toContain(`export/objekt-42/${beleg}.json`)

    const manifest = (await ablage.lesen('export/objekt-42/manifest.txt')).toString('utf8')
    expect(manifest).toContain('sha256sum -c manifest.txt')
    expect(manifest).toContain(`${beleg}.json`)
  })

  it('legt neben das Original eine gestempelte Lesefassung', async () => {
    const ablage = new Merkablage()

    // Der Beleg braucht eine echte Datei -- die uebrigen Tests hier kommen
    // ohne aus, weil sie die Metadaten pruefen.
    const { pdfBauen, rechnungsvorlage } = await import('./hilfe/pdf-bauen')
    const pdf = await pdfBauen(rechnungsvorlage())
    await ablage.schreiben('test/akte/original.pdf', pdf)
    await direkt(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
       values ($1, 'original', 'test/akte/original.pdf', 'application/pdf', $2)`,
      [beleg, pdf.byteLength],
    )

    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, ablage, OBJEKT_42, '2026-08-31'),
    )
    const geschrieben = await objektakteSchreiben(ablage, akte!, 'export/objekt-42')

    /*
     * **Der Grund, warum es das gibt.** Bis hierher bekam ein
     * Nachfolgeverwalter das rohe Original -- ein Blatt ohne eine einzige
     * Freigabe. Die Stempelhistorie lag daneben im JSON, aber wer die
     * Rechnung oeffnet, sah nicht, dass sie jemals geprueft wurde.
     */
    expect(geschrieben).toContain(`export/objekt-42/${beleg}-gestempelt.pdf`)

    // Und das Original bleibt: Nur es traegt den Hash aus dem Archiv.
    expect(geschrieben).toContain(`export/objekt-42/${beleg}.pdf`)
    expect(await ablage.lesen(`export/objekt-42/${beleg}.pdf`)).toEqual(pdf)

    // Beide stehen im Manifest, also laesst sich beides ohne uns pruefen.
    const { createHash } = await import('node:crypto')
    const lesefassung = await ablage.lesen(`export/objekt-42/${beleg}-gestempelt.pdf`)
    const hash = createHash('sha256').update(lesefassung).digest('hex')
    expect(akte?.manifest).toContain(`${hash}  ${beleg}-gestempelt.pdf`)
  })

  it('benennt einen Beleg ohne Lesefassung, statt ihn zu uebergehen', async () => {
    const ablage = new Merkablage()

    // Eine Datei, die kein PDF ist: Der Export scheitert, die Akte nicht.
    await ablage.schreiben('test/akte/kaputt.pdf', Buffer.from('kein PDF'))
    await direkt(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
       values ($1, 'original', 'test/akte/kaputt.pdf', 'application/pdf', 8)`,
      [beleg],
    )

    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, ablage, OBJEKT_42, '2026-08-31'),
    )

    // Eine Akte mit einer stillen Luecke ist schlimmer als eine mit einer
    // bekannten -- dieselbe Regel wie bei `ohneDatei`.
    expect(akte?.ohneLesefassung).toContain(beleg)
    expect(akte?.manifest).toContain('ohne gestempelte Lesefassung')
  })

  it('stimmt: der Hash im Manifest passt zur geschriebenen Datei', async () => {
    const ablage = new Merkablage()
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, ablage, OBJEKT_42, '2026-08-31'),
    )
    await objektakteSchreiben(ablage, akte!, 'export/objekt-42')

    const inhalt = await ablage.lesen(`export/objekt-42/${beleg}.json`)
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(inhalt).digest('hex')
    expect(akte?.manifest).toContain(`${hash}  ${beleg}.json`)
  })

  it('schreibt Datumsangaben als Datum, nicht als Zeitpunkt', async () => {
    // Beim Erzeugen der Akte gefunden: pg macht aus einem `date` ein
    // Date-Objekt in der Zeitzone des Servers -- aus dem 14. Maerz wurde
    // "2026-03-13T23:00:00Z". In einer Uebergabe an den Nachfolger ist ein
    // Rechnungsdatum, das einen Tag danebenliegt, kein Schoenheitsfehler.
    await direkt(
      `update rechnung_fakten set rechnungsdatum = date '2026-03-14'
        where dokument_id = $1`,
      [beleg],
    )
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, new Merkablage(), OBJEKT_42, '2026-08-31'),
    )
    const meiner = akte?.dokumente.find((d) => d.dokumentId === beleg)
    const kopf = (meiner?.metadaten as Record<string, unknown>)['beleg'] as Record<
      string,
      unknown
    >
    expect(kopf['rechnungsdatum']).toBe('2026-03-14')
  })

  it('schreibt Zeitstempel als gueltiges ISO-8601', async () => {
    // Die Akte geht an einen Nachfolger, der sie mit irgendeiner Bibliothek
    // liest. "2026-08-31T13:09:04+00" ist gueltiges Postgres und ungueltiges
    // ISO-8601 -- in einer Uebergabe ist das kein Schoenheitsfehler.
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, new Merkablage(), OBJEKT_42, '2026-08-31'),
    )
    const meiner = akte?.dokumente.find((d) => d.dokumentId === beleg)
    const kopf = (meiner?.metadaten as Record<string, unknown>)['beleg'] as Record<
      string,
      unknown
    >
    const eingang = String(kopf['eingang_am'])
    expect(Number.isNaN(new Date(eingang).getTime())).toBe(false)
  })

  it('schreibt ein Manifest, das "sha256sum -c" ohne Warnung liest', async () => {
    // Leere Zeilen quittiert sha256sum mit "improperly formatted" -- eine
    // Warnung beim Pruefen entwertet den Zweck des Manifests.
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, new Merkablage(), OBJEKT_42, '2026-08-31'),
    )
    const zeilen = akte!.manifest.split('\n')
    // Nur die letzte Zeile darf leer sein (abschliessender Zeilenumbruch).
    expect(zeilen.slice(0, -1).filter((z) => z.trim() === '')).toEqual([])
    // Jede Nicht-Kommentarzeile ist "<64 hex>  <name>".
    for (const z of zeilen.slice(0, -1).filter((z) => !z.startsWith('#'))) {
      expect(z).toMatch(/^[0-9a-f]{64} {2}\S+$/)
    }
  })

  it('gibt einem nicht zustaendigen Kollegen eine leere Akte', async () => {
    // Kein Fehler: Die Auskunft "Objekt existiert, Sie duerfen aber nicht"
    // waere bereits eine Auskunft.
    const akte = await alsBenutzer(CLARA, (c) =>
      objektakteZusammenstellen(c, new Merkablage(), OBJEKT_42, '2026-08-31'),
    )
    expect(akte).toBeNull()
  })

  it('nimmt eingeschraenkte Belege nicht mit', async () => {
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))
    const akte = await alsBenutzer(ANNA, (c) =>
      objektakteZusammenstellen(c, new Merkablage(), OBJEKT_42, '2026-08-31'),
    )
    expect(akte?.dokumente.map((d) => d.dokumentId)).not.toContain(beleg)
  })
})
