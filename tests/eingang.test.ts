/**
 * Tests der selbsttätigen Eingangskanäle (Konzept 13).
 *
 * Was hier zählt, ist nicht das Abholen — das ist Dateisystem und IMAP —,
 * sondern die vier Zusagen, die ein Kanal ohne Zuschauer geben muss:
 *
 *   * **Nichts kommt zweimal herein.** Eine Datei bleibt im Ordner liegen,
 *     eine Mail im Postfach. Ohne Merkliste füllt sich der Posteingang mit
 *     Dubletten, die alle rot sind.
 *   * **Nichts geht verloren.** Aufgenommen und vorgemerkt in einer
 *     Transaktion; eine Mail ohne Anhang wird selbst zum Beleg statt
 *     übersprungen zu werden.
 *   * **Ein Fehler an einer Quelle hält die anderen nicht auf** — und steht
 *     danach in der Quelle, nicht im Log.
 *   * **Halb geschriebene Dateien bleiben liegen.** Ein Scanner füllt eine
 *     Datei über Sekunden; wer sofort liest, bekommt ein halbes PDF.
 */

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DateisystemAblage } from '../src/ablage'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { aufbereiten } from '../src/worker/aufbereitung'
import {
  eingangAbholen,
  fundstueckeAusMail,
  mailQuelle,
  mailtext,

  quellenLaden,
  type Eingangsquelle,
  type Fundstueck,
  type Postfachzugang,
} from '../src/eingang'
import { pdfBauen, rechnungsvorlage } from './hilfe/pdf-bauen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

let wurzel: string
let ablage: DateisystemAblage
let ordner: string
let rechnung: Buffer

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/** Legt eine Quelle an und gibt ihre Kennung zurück. */
async function quelleAnlegen(
  art: 'ordner' | 'mail',
  einstellungen: Record<string, unknown>,
  eigenschaften: Record<string, unknown> = {},
): Promise<string> {
  const [z] = await direkt<{ id: string }>(
    `insert into eingangsquelle (mandant_id, art, bezeichnung, einstellungen,
                                 objekt_id, belegart, takt_sekunden, angelegt_von, aktiv)
     values ($1, $2, $3, $4::jsonb, $5, 'rechnung', 30, $6, $7)
     returning id`,
    [
      MANDANT,
      art,
      String(eigenschaften['bezeichnung'] ?? `Test ${art} ${Math.round(Math.random() * 1e9)}`),
      JSON.stringify(einstellungen),
      eigenschaften['objektId'] ?? OBJEKT_42,
      eigenschaften['angelegtVon'] ?? ANNA,
      eigenschaften['aktiv'] ?? true,
    ],
  )
  return z.id
}

/** Eine Mail zum Anfassen. Kein Parser, nur Text — so sieht eine echte aus. */
function mailBauen(
  kopf: { betreff: string; messageId: string },
  anhang?: { name: string; typ: string; inhalt: Buffer },
): Buffer {
  if (anhang === undefined) {
    return Buffer.from(
      [
        'From: Musterreinigung <info@musterreinigung.invalid>',
        'To: rechnung@verwaltung.invalid',
        `Subject: ${kopf.betreff}`,
        `Message-Id: <${kopf.messageId}>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Guten Tag,',
        'anbei koennen wir die Rechnung leider nicht mitschicken.',
        'Mit freundlichen Gruessen',
      ].join('\r\n'),
      'utf8',
    )
  }

  const grenze = 'grenze-abc-123'
  return Buffer.from(
    [
      'From: Musterreinigung <info@musterreinigung.invalid>',
      'To: rechnung@verwaltung.invalid',
      `Subject: ${kopf.betreff}`,
      `Message-Id: <${kopf.messageId}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${grenze}"`,
      '',
      `--${grenze}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Anbei die Rechnung.',
      '',
      `--${grenze}`,
      `Content-Type: ${anhang.typ}`,
      `Content-Disposition: attachment; filename="${anhang.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      anhang.inhalt.toString('base64').replace(/(.{76})/g, '$1\r\n'),
      '',
      `--${grenze}--`,
      '',
    ].join('\r\n'),
    'utf8',
  )
}

beforeEach(async () => {
  wurzel = await mkdtemp(join(tmpdir(), 'dms-eingang-'))
  ablage = new DateisystemAblage(join(wurzel, 'ablage'))
  ordner = join(wurzel, 'eingang')
  await mkdir(ordner, { recursive: true })
  rechnung = await pdfBauen(rechnungsvorlage())
})

afterEach(async () => {
  // Die Belege aus dem Test wieder loswerden -- sie haengen an der
  // Merkliste, die per Kaskade mitgeht.
  const c = await verbindungspool().connect()
  try {
    await c.query('alter table dokument disable trigger dokument_archiv_schutz')
    // Erst die Dublettenverkettung loesen: Zweimal dieselbe Rechnung ergibt
    // zwei Belege, von denen der zweite auf den ersten zeigt -- und der
    // Selbstbezug blockiert sonst das Loeschen.
    await c.query(
      `update dokument set dublette_von = null
        where dublette_von in (select dokument_id from eingang_geholt)`,
    )
    await c.query(
      `delete from dokument where id in (
         select dokument_id from eingang_geholt where dokument_id is not null)`,
    )
    await c.query('delete from eingangsquelle')
  } finally {
    await c.query('alter table dokument enable trigger dokument_archiv_schutz')
    c.release()
  }
  await rm(wurzel, { recursive: true, force: true })
})

afterAll(poolSchliessen)

/** Legt eine Datei so ab, dass die Ruhefrist bereits abgelaufen ist. */
async function ablegen(name: string, inhalt: Buffer): Promise<void> {
  const pfad = join(ordner, name)
  await writeFile(pfad, inhalt)
  const alt = new Date(Date.now() - 60_000)
  await utimes(pfad, alt, alt)
}

describe('Überwachter Ordner', () => {
  it('nimmt eine abgelegte Rechnung auf', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: ordner })

    const bericht = await eingangAbholen(ablage)
    expect(bericht.aufgenommen).toBe(1)

    const [d] = await direkt<{ eingangskanal: string; objekt_id: string }>(
      `select d.eingangskanal, d.objekt_id from dokument d
         join eingang_geholt g on g.dokument_id = d.id`,
    )
    expect(d.eingangskanal).toBe('ftp')
    // Die Vorbelegung der Quelle traegt: Ein Ordner je Objekt erspart die
    // Zuordnung von Hand.
    expect(d.objekt_id).toBe(OBJEKT_42)
  })

  it('holt dieselbe Datei nicht zweimal', async () => {
    await ablegen('rechnung.pdf', rechnung)
    const quelleId = await quelleAnlegen('ordner', { pfad: ordner })

    expect((await eingangAbholen(ablage)).aufgenommen).toBe(1)

    // Takt zuruecksetzen, sonst ist die Quelle noch nicht wieder faellig.
    await direkt('update eingangsquelle set zuletzt_geprueft = null where id = $1', [quelleId])
    expect((await eingangAbholen(ablage)).aufgenommen).toBe(0)
  })

  it('laesst eine Datei liegen, die noch geschrieben wird', async () => {
    // Ohne alte Aenderungszeit: gerade eben geschrieben.
    await writeFile(join(ordner, 'frisch.pdf'), rechnung)
    await quelleAnlegen('ordner', { pfad: ordner, ruhefrist_sekunden: 30 })

    // Ein Scanner fuellt die Datei ueber Sekunden. Wer sofort liest, bekommt
    // ein halbes PDF -- und die Aufbereitung meldet einen kaputten Beleg,
    // der in Ordnung war.
    expect((await eingangAbholen(ablage)).aufgenommen).toBe(0)
  })

  it('uebergeht Dateien, die keine Belege sein koennen', async () => {
    await ablegen('notiz.txt', Buffer.from('nur eine Notiz'))
    await ablegen('bild.jpg', Buffer.from([0xff, 0xd8, 0xff]))
    await quelleAnlegen('ordner', { pfad: ordner })

    expect((await eingangAbholen(ablage)).aufgenommen).toBe(0)
  })

  it('verschiebt nach dem Aufnehmen, wenn ein Zielordner eingestellt ist', async () => {
    await ablegen('rechnung.pdf', rechnung)
    const erledigt = join(wurzel, 'erledigt')
    await quelleAnlegen('ordner', { pfad: ordner, erledigt_pfad: erledigt })

    await eingangAbholen(ablage)

    expect(await readdir(ordner)).toEqual([])
    expect((await readdir(erledigt))[0]).toMatch(/^rechnung-\d+\.pdf$/)
  })

  it('laesst die Datei liegen, wenn kein Zielordner eingestellt ist', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: ordner })

    await eingangAbholen(ablage)

    // Ein Programm, das ungefragt in fremden Ordnern verschiebt, macht mehr
    // kaputt als es hilft. Die Merkliste traegt.
    expect(await readdir(ordner)).toEqual(['rechnung.pdf'])
  })

  it('haelt einen fehlenden Ordner in der Quelle fest, nicht im Log', async () => {
    await quelleAnlegen('ordner', { pfad: join(wurzel, 'gibt-es-nicht') })

    const bericht = await eingangAbholen(ablage)
    expect(bericht.gescheitert).toBe(1)

    const [q] = await quellenLaden(ANNA)
    expect(q.letzterFehler).toContain('gibt es nicht')
    // Geprueft wurde, Erfolg gab es keinen -- der Unterschied ist die
    // Auskunft, auf die es ankommt.
    expect(q.zuletztGeprueft).not.toBeNull()
    expect(q.zuletztErfolg).toBeNull()
  })

  it('verlangt einen Pfad', async () => {
    await quelleAnlegen('ordner', {})
    await eingangAbholen(ablage)

    const [q] = await quellenLaden(ANNA)
    expect(q.letzterFehler).toContain('pfad')
  })
})

describe('Mail: was aus einer Nachricht wird', () => {
  it('macht aus jedem Rechnungsanhang einen Beleg', async () => {
    const mail = mailBauen(
      { betreff: 'Rechnung RE-2026-0001', messageId: 'a@musterreinigung.invalid' },
      { name: 'RE-2026-0001.pdf', typ: 'application/pdf', inhalt: rechnung },
    )

    const stuecke = await fundstueckeAusMail(mail, 'ersatz')
    expect(stuecke).toHaveLength(1)
    expect(stuecke[0].dateiname).toBe('RE-2026-0001.pdf')
    expect(stuecke[0].mime).toBe('application/pdf')
    // Message-Id **und** Anhangsname: Eine Mail mit zwei Rechnungen ergibt
    // zwei Belege, die sich unterscheiden lassen muessen.
    expect(stuecke[0].herkunft).toContain('RE-2026-0001.pdf')
    expect(stuecke[0].inhalt.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('macht aus einer Mail ohne Anhang die Mail selbst', async () => {
    const mail = mailBauen({ betreff: 'Rueckfrage zur Abrechnung', messageId: 'b@x.invalid' })

    // Sie stillschweigend zu ueberspringen waere der schlechteste Ausgang:
    // Der Absender hat geschrieben, im DMS steht nichts, niemand erfaehrt es.
    const stuecke = await fundstueckeAusMail(mail, 'ersatz')
    expect(stuecke).toHaveLength(1)
    expect(stuecke[0].mime).toBe('message/rfc822')
    expect(stuecke[0].dateiname).toBe('Rueckfrage zur Abrechnung.eml')
  })

  it('nimmt die Ersatzkennung, wenn die Message-Id fehlt', async () => {
    const ohneId = Buffer.from(
      ['Subject: Ohne Kennung', 'Content-Type: text/plain', '', 'Text'].join('\r\n'),
      'utf8',
    )
    const stuecke = await fundstueckeAusMail(ohneId, 'uid:4711')
    expect(stuecke[0].herkunft).toBe('uid:4711')
  })

  it('macht aus einem Signaturbild keinen Beleg', async () => {
    const grenze = 'g1'
    const mitLogo = Buffer.from(
      [
        'Subject: Mit Briefkopf',
        'Message-Id: <c@x.invalid>',
        'MIME-Version: 1.0',
        `Content-Type: multipart/related; boundary="${grenze}"`,
        '',
        `--${grenze}`,
        'Content-Type: text/plain',
        '',
        'Text',
        '',
        `--${grenze}`,
        'Content-Type: application/pdf',
        'Content-Disposition: inline; filename="briefkopf.pdf"',
        'Content-Id: <logo1>',
        'Content-Transfer-Encoding: base64',
        '',
        rechnung.toString('base64').replace(/(.{76})/g, '$1\r\n'),
        '',
        `--${grenze}--`,
        '',
      ].join('\r\n'),
      'utf8',
    )

    // Ohne diese Pruefung entstuende aus jeder Kanzleimail ein Dutzend
    // Belege aus Briefkopfgrafiken.
    const stuecke = await fundstueckeAusMail(mitLogo, 'ersatz')
    expect(stuecke.every((s) => s.mime === 'message/rfc822')).toBe(true)
  })

  it('gewinnt aus einer Mail lesbaren Text', async () => {
    const mail = mailBauen({ betreff: 'Rueckfrage zur Abrechnung', messageId: 'd@x.invalid' })
    const text = await mailtext(mail)

    expect(text).toContain('Rueckfrage zur Abrechnung')
    expect(text).toContain('musterreinigung.invalid')
    expect(text).toContain('anbei koennen wir die Rechnung')
  })
})

describe('Mail als Quelle', () => {
  /** Ein Postfach, das ohne Server auskommt. */
  function postfach(mails: Array<{ messageId: string; roh: Buffer }>): Postfachzugang {
    return {
      async nachrichten(_einstellungen, bereitsGeholt, hoechstzahl) {
        const offen = []
        for (const m of mails) {
          if (offen.length >= hoechstzahl) break
          if (await bereitsGeholt(m.messageId)) continue
          offen.push(m)
        }
        return offen
      },
    }
  }

  it('nimmt den Anhang auf und merkt sich die Nachricht', async () => {
    const mail = mailBauen(
      { betreff: 'Rechnung', messageId: 'e@x.invalid' },
      { name: 'rechnung.pdf', typ: 'application/pdf', inhalt: rechnung },
    )
    const quelleId = await quelleAnlegen('mail', { host: 'x', benutzer: 'y' })
    const quellen = () => mailQuelle(postfach([{ messageId: 'e@x.invalid', roh: mail }]))

    expect((await eingangAbholen(ablage, quellen)).aufgenommen).toBe(1)

    const [d] = await direkt<{ eingangskanal: string }>(
      `select d.eingangskanal from dokument d
         join eingang_geholt g on g.dokument_id = d.id`,
    )
    expect(d.eingangskanal).toBe('mail')

    await direkt('update eingangsquelle set zuletzt_geprueft = null where id = $1', [quelleId])
    expect((await eingangAbholen(ablage, quellen)).aufgenommen).toBe(0)
  })
})

describe('Mail als Schriftverkehr', () => {
  function postfachMit(roh: Buffer, id: string): Postfachzugang {
    return {
      async nachrichten(_e, bereitsGeholt) {
        return (await bereitsGeholt(id)) ? [] : [{ messageId: id, roh }]
      },
    }
  }

  it('fuehrt eine Nachricht ohne Anhang als Schriftverkehr, nicht als Rechnung', async () => {
    const mail = mailBauen({ betreff: 'Rueckfrage', messageId: 'f@x.invalid' })
    await quelleAnlegen('mail', { host: 'x', benutzer: 'y' })

    await eingangAbholen(ablage, () => mailQuelle(postfachMit(mail, '<f@x.invalid>')))

    const [d] = await direkt<{ belegart: string }>(
      `select d.belegart from dokument d join eingang_geholt g on g.dokument_id = d.id`,
    )
    // Da hat jemand geschrieben. Als Rechnung gefuehrt, erwartete das System
    // einen Beleg, den es nicht gibt -- und die Plausibilitaetspruefung
    // schluege zu Recht an.
    expect(d.belegart).toBe('schriftverkehr')
  })

  it('macht aus dem Anhang trotzdem eine Rechnung', async () => {
    const mail = mailBauen(
      { betreff: 'Rechnung', messageId: 'g@x.invalid' },
      { name: 'rechnung.pdf', typ: 'application/pdf', inhalt: rechnung },
    )
    await quelleAnlegen('mail', { host: 'x', benutzer: 'y' })

    await eingangAbholen(ablage, () => mailQuelle(postfachMit(mail, '<g@x.invalid>')))

    const [d] = await direkt<{ belegart: string }>(
      `select d.belegart from dokument d join eingang_geholt g on g.dokument_id = d.id`,
    )
    expect(d.belegart).toBe('rechnung')
  })

  it('macht den Mailtext bei der Aufbereitung durchsuchbar', async () => {
    const mail = mailBauen({ betreff: 'Rueckfrage zur Hausreinigung', messageId: 'h@x.invalid' })
    await quelleAnlegen('mail', { host: 'x', benutzer: 'y' })
    await eingangAbholen(ablage, () => mailQuelle(postfachMit(mail, '<h@x.invalid>')))

    const [d] = await direkt<{ id: string }>(
      `select d.id from dokument d join eingang_geholt g on g.dokument_id = d.id`,
    )
    const bericht = await alsBenutzer(ANNA, (c) => aufbereiten(c, ablage, d.id, null))

    // Ohne diesen Zweig laege die Nachricht mit null Seiten und leerem Text
    // im Posteingang -- unauffindbar, obwohl jemand geschrieben hat.
    expect(bericht.weg).toBe('mail')
    const [s] = await direkt<{ text: string }>(
      'select text from dokument_seite where dokument_id = $1 and seite = 1',
      [d.id],
    )
    expect(s.text).toContain('Rueckfrage zur Hausreinigung')
    expect(s.text).toContain('musterreinigung.invalid')
  })
})

describe('Mehrere Quellen', () => {
  it('laesst eine kaputte Quelle die andere nicht aufhalten', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: join(wurzel, 'weg') }, { bezeichnung: 'A kaputt' })
    await quelleAnlegen('ordner', { pfad: ordner }, { bezeichnung: 'B heil' })

    const bericht = await eingangAbholen(ablage)

    // Ein abgelaufenes Postfachpasswort darf den ueberwachten Ordner nicht
    // blockieren.
    expect(bericht.gescheitert).toBe(1)
    expect(bericht.aufgenommen).toBe(1)
  })

  it('uebergeht eine abgeschaltete Quelle', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: ordner }, { aktiv: false })

    expect((await eingangAbholen(ablage)).quellen).toBe(0)
  })

  it('uebergeht eine Quelle, deren Einrichter gesperrt ist', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: ordner })
    await direkt('update benutzer set aktiv = false where id = $1', [ANNA])

    try {
      // Sie steht dann sichtbar still, statt unter dem Namen eines
      // Ausgeschiedenen weiterzulaufen.
      expect((await eingangAbholen(ablage)).quellen).toBe(0)
    } finally {
      await direkt('update benutzer set aktiv = true where id = $1', [ANNA])
    }
  })

  it('zaehlt nur, was wirklich hereinkam', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: ordner })
    await eingangAbholen(ablage)

    const [q] = await quellenLaden(ANNA)
    expect(q.aufgenommen).toBe(1)
    expect(q.letzterFehler).toBeNull()
    expect(q.zuletztErfolg).not.toBeNull()
  })
})

describe('Mandantengrenze', () => {
  it('zeigt Doris die Quellen des fremden Mandanten nicht', async () => {
    await quelleAnlegen('ordner', { pfad: ordner })

    expect(await quellenLaden(ANNA)).toHaveLength(1)
    expect(await quellenLaden(DORIS)).toEqual([])
  })

  it('nimmt den Beleg im Mandanten der Quelle auf, nicht im Mandanten des Aufrufers', async () => {
    await ablegen('rechnung.pdf', rechnung)
    await quelleAnlegen('ordner', { pfad: ordner })
    await eingangAbholen(ablage)

    const [d] = await direkt<{ mandant_id: string }>(
      `select d.mandant_id from dokument d join eingang_geholt g on g.dokument_id = d.id`,
    )
    expect(d.mandant_id).toBe(MANDANT)
  })
})

describe('Eigene Quellenart', () => {
  it('reicht jedes Fundstueck durch denselben Eingang', async () => {
    const eigene: Eingangsquelle = {
      art: 'ordner',
      async holen(): Promise<Fundstueck[]> {
        return [
          {
            herkunft: 'erfunden-1',
            dateiname: 'aus-der-luft.pdf',
            mime: 'application/pdf',
            inhalt: rechnung,
          },
        ]
      },
    }
    await quelleAnlegen('ordner', { pfad: ordner })

    // Eine Quelle liefert Bytes, sonst nichts -- Hash, Dublettenpruefung und
    // Warteschlange sind fuer alle dieselben.
    expect((await eingangAbholen(ablage, () => eigene)).aufgenommen).toBe(1)

    const [d] = await direkt<{ inhalt_hash: string }>(
      `select d.inhalt_hash from dokument d join eingang_geholt g on g.dokument_id = d.id`,
    )
    expect(d.inhalt_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
