/**
 * Tests der Texterkennung.
 *
 * Die Erkennung selbst wird **nicht** getestet — dafür bräuchte es Tesseract
 * auf dem Testrechner, und ein Test, der ohne Installation stillschweigend
 * durchläuft, ist schlimmer als keiner.
 *
 * Getestet wird, was das DMS tut: wann es erkennt, was es mit dem Ergebnis
 * macht, und vor allem, was passiert, wenn keine Erkennung da ist.
 *
 * Der letzte Fall ist der eigentliche Anlass. Vorher lief ein Scan ohne
 * Textlayer einfach durch: Status `laufend`, Seiten ohne Text, keine Suche,
 * keine Extraktion, keine Zuordnung — und niemand erfuhr davon. Für eine
 * Verwaltung, deren Hauptkanal der Scanner ist, war das die stillste aller
 * Lücken.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DateisystemAblage } from '../src/ablage'
import { dokumentAufnehmen, type Eingang } from '../src/ingest/aufnehmen'
import { aufbereiten } from '../src/worker/aufbereitung'
import {
  ErkennungFehlgeschlagen,
  ocrEingerichtet,
  ocrmypdfErkennung,
  texterkennung,
  type Texterkennung,
} from '../src/ocr'
import { pdfBauen, rechnungsvorlage, scanvorlage } from './hilfe/pdf-bauen'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:15322/postgres'

const MANDANT_NORD = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

let client: Client
let wurzel: string
let ablage: DateisystemAblage
let rechnung: Buffer
let scan: Buffer

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
  wurzel = await mkdtemp(join(tmpdir(), 'dms-ocr-test-'))
  ablage = new DateisystemAblage(wurzel)
  rechnung = await pdfBauen(rechnungsvorlage())
  scan = await pdfBauen(scanvorlage())
})

afterAll(async () => {
  await client.end()
  await rm(wurzel, { recursive: true, force: true })
})

/**
 * Alles in einer Transaktion, die zurückgerollt wird.
 *
 * Auch die Fehlerkorb-Einträge verschwinden damit wieder — sonst müsste jeder
 * Test hier aufräumen, was `verarbeitungsfehler_melden` geschrieben hat.
 */
async function alsAnna<T>(aktion: (c: Client) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role dms_app')
    await client.query('select set_config($1, $2, true)', ['app.benutzer_id', ANNA])
    return await aktion(client)
  } finally {
    await client.query('rollback')
  }
}

function eingang(inhalt: Buffer): Eingang {
  return {
    mandantId: MANDANT_NORD,
    objektId: OBJEKT_42,
    belegart: 'rechnung',
    eingangskanal: 'scan',
    dateiname: 'beleg.pdf',
    mime: 'application/pdf',
    inhalt,
  }
}

async function korbEintraege(c: Client, dokumentId: string): Promise<string[]> {
  const { rows } = await c.query<{ grund: string }>(
    'select grund from verarbeitungsfehler where dokument_id = $1',
    [dokumentId],
  )
  return rows.map((z) => z.grund)
}

/** Welche `dms-ocr-*`-Verzeichnisse gerade im Temp-Ordner liegen. */
async function ocrVerzeichnisse(): Promise<string[]> {
  const eintraege = await readdir(tmpdir())
  return eintraege.filter((n) => n.startsWith('dms-ocr-')).sort()
}

/** Eine Erkennung, die das mitgegebene PDF zurückgibt. */
function erkennerDer(pdf: Buffer): Texterkennung {
  return {
    name: 'test',
    async verfuegbar() {
      return true
    },
    async erkennen() {
      return { pdf, dauerMs: 1 }
    },
  }
}

const NICHT_DA: Texterkennung = {
  name: 'ocrmypdf',
  async verfuegbar() {
    return false
  },
  async erkennen() {
    throw new Error('sollte nie aufgerufen werden')
  },
}

describe('Ohne Erkennung', () => {
  it('legt einen Scan in den Fehlerkorb, statt ihn still durchzulassen', async () => {
    const { bericht, gruende } = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(scan), ANNA)
      const bericht = await aufbereiten(c as never, ablage, auf.dokumentId, null)
      return { bericht, gruende: await korbEintraege(c, auf.dokumentId) }
    })

    expect(bericht.weg).toBe('ocr_noetig')
    expect(gruende).toHaveLength(1)
    expect(gruende[0]).toContain('DMS_OCR')
  })

  it('nennt das Werkzeug, wenn es eingerichtet, aber nicht aufrufbar ist', async () => {
    const gruende = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(scan), ANNA)
      await aufbereiten(c as never, ablage, auf.dokumentId, NICHT_DA)
      return korbEintraege(c, auf.dokumentId)
    })

    // Zwei verschiedene Handgriffe: einstellen oder installieren. Der Grund
    // muss sagen, welcher gemeint ist.
    expect(gruende[0]).toContain('ocrmypdf')
    expect(gruende[0]).not.toContain('DMS_OCR')
  })

  it('laesst einen Beleg mit Textlayer unberuehrt', async () => {
    const gruende = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      const bericht = await aufbereiten(c as never, ablage, auf.dokumentId, null)
      expect(bericht.weg).toBe('textlayer')
      return korbEintraege(c, auf.dokumentId)
    })

    // Der Korb ist fuer Belege da, an denen etwas fehlt -- nicht fuer jeden,
    // der keine Erkennung gebraucht hat.
    expect(gruende).toEqual([])
  })
})

describe('Mit Erkennung', () => {
  it('uebernimmt den erkannten Text und meldet nichts in den Korb', async () => {
    const erkannt = await pdfBauen([
      {
        zeilen: [
          'Musterreinigung GmbH, Beispielweg 1, 00000 Musterstadt',
          'Rechnung RE-2026-0042 vom 01.09.2026',
          'Erkannt aus einem Scan, nicht aus dem Textlayer',
        ],
      },
    ])

    const { bericht, texte, gruende } = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(scan), ANNA)
      const bericht = await aufbereiten(c as never, ablage, auf.dokumentId, erkennerDer(erkannt))
      const { rows } = await c.query<{ text: string }>(
        'select text from dokument_seite where dokument_id = $1 order by seite',
        [auf.dokumentId],
      )
      return {
        bericht,
        texte: rows.map((z) => z.text),
        gruende: await korbEintraege(c, auf.dokumentId),
      }
    })

    expect(bericht.weg).toBe('ocr')
    // Der Text stammt aus der erkannten Fassung, nicht aus dem Original.
    expect(texte[0]).toContain('RE-2026-0042')
    expect(gruende).toEqual([])
  })

  it('legt die erkannte Fassung als PDF/A-Derivat ab und laesst das Original', async () => {
    const erkannt = await pdfBauen([{ zeilen: ['Erkannter Text fuer das Derivat'] }])

    const { dateien, original } = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(scan), ANNA)
      await aufbereiten(c as never, ablage, auf.dokumentId, erkennerDer(erkannt))
      const { rows } = await c.query<{ variante: string; storage_key: string }>(
        `select variante, storage_key from dokument_datei
          where dokument_id = $1 and variante in ('original','pdfa_derivat')
          order by variante`,
        [auf.dokumentId],
      )
      const originalZeile = rows.find((z) => z.variante === 'original')
      return {
        dateien: rows,
        original: await ablage.lesen(String(originalZeile?.storage_key)),
      }
    })

    const derivat = dateien.find((z) => z.variante === 'pdfa_derivat')
    expect(derivat).toBeDefined()
    expect(await ablage.lesen(String(derivat?.storage_key))).toEqual(erkannt)

    // Das Original wird nie veraendert (Projektregel) -- auch nicht von der
    // Erkennung, die gerade eine bessere Fassung erzeugt hat.
    expect(original).toEqual(scan)
  })

  it('reicht einen Fehler durch, damit die Warteschlange wiederholt', async () => {
    const kaputt: Texterkennung = {
      name: 'test',
      async verfuegbar() {
        return true
      },
      async erkennen() {
        throw new ErkennungFehlgeschlagen('ocrmypdf endete mit 2: kaputte Seite')
      },
    }

    // Bewusst nicht abgefangen: Ein gescheiterter Lauf kann voruebergehend
    // sein. Die Warteschlange versucht es dreimal und legt ihn danach selbst
    // in den Korb -- mit dem echten Grund statt einem selbstgeschriebenen.
    await expect(
      alsAnna(async (c) => {
        const auf = await dokumentAufnehmen(c as never, ablage, eingang(scan), ANNA)
        return aufbereiten(c as never, ablage, auf.dokumentId, kaputt)
      }),
    ).rejects.toThrow(ErkennungFehlgeschlagen)
  })
})

describe('Zweiter Lauf', () => {
  it('verdoppelt die Derivate nicht', async () => {
    const anzahl = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      await aufbereiten(c as never, ablage, auf.dokumentId, null)
      await aufbereiten(c as never, ablage, auf.dokumentId, null)
      const { rows } = await c.query<{ n: string }>(
        `select count(*) n from dokument_datei
          where dokument_id = $1 and variante = 'ansicht_webp'`,
        [auf.dokumentId],
      )
      return Number(rows[0].n)
    })

    // Zwei Leseseiten plus eine Miniatur -- nicht das Doppelte. Seit dem
    // Fehlerkorb laesst sich eine Aufbereitung auf Knopfdruck wiederholen,
    // und `dokument_datei` hat auf (dokument, variante) nur einen Index,
    // keine Eindeutigkeit.
    expect(anzahl).toBe(3)
  })
})

describe('Anbieterauswahl', () => {
  it('ist ohne DMS_OCR nicht eingerichtet', () => {
    expect(texterkennung()).toBeNull()
    expect(ocrEingerichtet()).toBe(false)
  })

  it('waehlt ocrmypdf, wenn es eingestellt ist', () => {
    process.env['DMS_OCR'] = 'ocrmypdf'
    try {
      expect(texterkennung()?.name).toBe('ocrmypdf')
    } finally {
      delete process.env['DMS_OCR']
    }
  })

  /**
   * Der Aufruf selbst, gegen ein Programm, das es überall gibt.
   *
   * `node` mit ocrmypdf-Argumenten scheitert sofort — das ist der Punkt. So
   * lässt sich die Fehlerbehandlung prüfen, ohne Tesseract vorauszusetzen,
   * und vor allem die Zusage, dass die Zwischendateien verschwinden. Sie
   * tragen Belegtext; ein Test dafür ist keine Formalie.
   */
  it('raeumt die Zwischendateien weg, auch wenn der Aufruf scheitert', async () => {
    const alt = process.env['DMS_OCR_PROGRAMM']
    process.env['DMS_OCR_PROGRAMM'] = process.execPath
    try {
      const vorher = await ocrVerzeichnisse()

      await expect(ocrmypdfErkennung.erkennen(scan)).rejects.toThrow(ErkennungFehlgeschlagen)

      expect(await ocrVerzeichnisse()).toEqual(vorher)
    } finally {
      if (alt === undefined) delete process.env['DMS_OCR_PROGRAMM']
      else process.env['DMS_OCR_PROGRAMM'] = alt
    }
  })

  it('meldet sich als nicht verfuegbar, wenn das Programm fehlt', async () => {
    // Ein fehlendes Programm muss eine *Antwort* sein und kein Absturz --
    // davon haengt ab, ob der Beleg im Korb landet oder der Worker stirbt.
    const alt = process.env['DMS_OCR_PROGRAMM']
    process.env['DMS_OCR_PROGRAMM'] = 'ocrmypdf-gibt-es-hier-nicht'
    try {
      expect(await ocrmypdfErkennung.verfuegbar()).toBe(false)
    } finally {
      if (alt === undefined) delete process.env['DMS_OCR_PROGRAMM']
      else process.env['DMS_OCR_PROGRAMM'] = alt
    }
  })
})
