/**
 * Posteingang: Stapel aufnehmen, trennen, übernehmen.
 *
 * Der Ablauf und die Begründung stehen in der Migration
 * `20260831240000_stapel.sql`. Kurz: Ein Stapel ist **kein Dokument**. Bis
 * zur Übernahme ist nichts geschrieben, was zurückgenommen werden müsste —
 * genau das verlangt Konzept 24.1.
 *
 *   aufnehmen  → Datei in die Ablage, Seiten lesen, Trennung vorschlagen
 *   prüfen     → Mensch bestätigt oder korrigiert
 *   übernehmen → je Beleg eine eigene PDF-Datei mit eigenem Hash
 */

import { PDFDocument } from 'pdf-lib'
import type { PoolClient } from 'pg'
import { inhaltHash, type Ablage } from '@/ablage'
import { alsBenutzer } from '@/db'
import { dokumentAufnehmen, type Eingangskanal } from '@/ingest/aufnehmen'
import { stapelEinreihen } from '@/queue'

export * from './trennung'

export class StapelAbgelehnt extends Error {}

export interface Stapelkopf {
  stapelId: string
  dateiname: string
  eingangskanal: string
  seitenzahl: number
  status: string
  eingangAm: string
  belege: number
}

export interface Stapelseite {
  seite: number
  trenner: boolean
  belegNr: number | null
  quelle: string
  auszug: string
}

/**
 * Nimmt eine Datei als Stapel auf.
 *
 * Hier passiert **nur** das Nötigste: Hash bilden, Datei ablegen, Zeile
 * schreiben, Auftrag einreihen. Seiten lesen und rendern übernimmt der
 * Worker (`src/worker/stapelaufbereitung.ts`) — ein Stapel mit dreißig
 * Seiten gehört nicht in einen Request.
 *
 * Deshalb steht der Stapel danach auf `aufbereitung` und nicht sofort auf
 * `pruefung`: Zwischen Hochladen und Korrekturoberfläche liegt Arbeit, und
 * sie ist sichtbar.
 */
export async function stapelAufnehmen(
  benutzerId: string,
  ablage: Ablage,
  eingang: {
    mandantId: string
    dateiname: string
    eingangskanal: Eingangskanal
    inhalt: Buffer
  },
): Promise<string> {
  if (eingang.inhalt.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new StapelAbgelehnt(
      'Nur PDF-Dateien lassen sich in Belege trennen. Andere Formate bitte ' +
        'einzeln aufnehmen.',
    )
  }

  const hash = inhaltHash(eingang.inhalt)
  const schluessel = `stapel/${eingang.mandantId}/${hash.slice(0, 16)}/original.pdf`

  await ablage.schreiben(schluessel, eingang.inhalt)

  const stapelId = await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into stapel (mandant_id, eingangskanal, dateiname, storage_key,
                           inhalt_hash, status, erfasst_von)
       values ($1, $2, $3, $4, $5, 'aufbereitung', app.mein_benutzer())
       on conflict (mandant_id, inhalt_hash) do nothing
       returning id`,
      [
        eingang.mandantId,
        eingang.eingangskanal,
        eingang.dateiname,
        schluessel,
        hash,
      ],
    )
    if (rows[0] === undefined) return null

    // In derselben Transaktion eingereiht wie der Stapel angelegt: Bricht sie
    // ab, gibt es weder Zeile noch Auftrag. Dieselbe Begründung wie beim
    // Dokumenteingang (src/queue.ts).
    await stapelEinreihen(
      { stapelId: rows[0].id, mandantId: eingang.mandantId, benutzerId },
      c,
    )
    return rows[0].id
  })

  if (stapelId === null) {
    throw new StapelAbgelehnt('Diese Datei ist bereits als Stapel eingegangen.')
  }
  return stapelId
}

export async function stapelLaden(
  benutzerId: string,
  stapelId: string,
): Promise<{ kopf: Stapelkopf; seiten: Stapelseite[] } | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select s.id, s.dateiname, s.eingangskanal, s.seitenzahl, s.status,
              s.eingang_am,
              (select count(distinct beleg_nr) from stapel_seite z
                where z.stapel_id = s.id and z.beleg_nr is not null) as belege
         from stapel s where s.id = $1`,
      [stapelId],
    )
    const k = rows[0]
    if (k === undefined) return null

    const { rows: seiten } = await c.query<Record<string, unknown>>(
      `select seite, trenner, beleg_nr, quelle,
              left(coalesce(replace(text, E'\\n', ' '), ''), 90) as auszug
         from stapel_seite where stapel_id = $1 order by seite`,
      [stapelId],
    )

    return {
      kopf: {
        stapelId: String(k['id']),
        dateiname: String(k['dateiname']),
        eingangskanal: String(k['eingangskanal']),
        seitenzahl: Number(k['seitenzahl']),
        status: String(k['status']),
        eingangAm: (k['eingang_am'] as Date).toISOString(),
        belege: Number(k['belege']),
      },
      seiten: seiten.map((z) => ({
        seite: Number(z['seite']),
        trenner: Boolean(z['trenner']),
        belegNr: z['beleg_nr'] == null ? null : Number(z['beleg_nr']),
        quelle: String(z['quelle']),
        auszug: String(z['auszug'] ?? '').trim(),
      })),
    }
  })
}

/** Die offenen Stapel — was noch auf Prüfung wartet. */
export async function offeneStapel(benutzerId: string): Promise<Stapelkopf[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select s.id, s.dateiname, s.eingangskanal, s.seitenzahl, s.status,
              s.eingang_am,
              (select count(distinct beleg_nr) from stapel_seite z
                where z.stapel_id = s.id and z.beleg_nr is not null) as belege
         from stapel s
        where s.status in ('aufbereitung','pruefung')
        order by s.eingang_am`,
    )
    return rows.map((k) => ({
      stapelId: String(k['id']),
      dateiname: String(k['dateiname']),
      eingangskanal: String(k['eingangskanal']),
      seitenzahl: Number(k['seitenzahl']),
      status: String(k['status']),
      eingangAm: (k['eingang_am'] as Date).toISOString(),
      belege: Number(k['belege']),
    }))
  })
}

/** Setzt oder hebt eine Trennung auf und nummeriert neu. */
export async function trennungAendern(
  benutzerId: string,
  stapelId: string,
  seite: number,
  trenner: boolean,
): Promise<number> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ stapel_trennen: number }>(
      'select app.stapel_trennen($1, $2, $3)',
      [stapelId, seite, trenner],
    )
    return rows[0]?.stapel_trennen ?? -1
  })
}

/**
 * Übernimmt den Stapel: je Beleg ein Dokument.
 *
 * Hier — und erst hier — entstehen Hashes. Jeder Beleg bekommt seine eigene
 * PDF-Datei aus den ihm zugeordneten Seiten, und darüber seinen eigenen Hash.
 * Das ist der Grund für die ganze Bauart: Ein Hash über die Scandatei wäre
 * für keinen der zwanzig Belege der richtige.
 */
export async function stapelUebernehmen(
  benutzerId: string,
  ablage: Ablage,
  stapelId: string,
): Promise<Array<{ belegNr: number; dokumentId: string; dublette: boolean }>> {
  const geladen = await stapelLaden(benutzerId, stapelId)
  if (geladen === null) throw new StapelAbgelehnt('Der Stapel ist nicht erreichbar.')
  if (geladen.kopf.status === 'uebernommen') {
    throw new StapelAbgelehnt('Dieser Stapel ist bereits übernommen.')
  }
  if (geladen.kopf.belege === 0) {
    throw new StapelAbgelehnt(
      'Der Stapel enthält keinen Beleg — alle Seiten sind als Trennblatt markiert.',
    )
  }

  const { storageKey, mandantId } = await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ storage_key: string; mandant_id: string }>(
      'select storage_key, mandant_id from stapel where id = $1',
      [stapelId],
    )
    return { storageKey: rows[0].storage_key, mandantId: rows[0].mandant_id }
  })

  const quelle = await PDFDocument.load(await ablage.lesen(storageKey))

  const gruppen = new Map<number, number[]>()
  for (const s of geladen.seiten) {
    if (s.belegNr === null) continue
    const vorhanden = gruppen.get(s.belegNr) ?? []
    vorhanden.push(s.seite)
    gruppen.set(s.belegNr, vorhanden)
  }

  const ergebnis: Array<{ belegNr: number; dokumentId: string; dublette: boolean }> = []

  for (const [belegNr, seiten] of [...gruppen.entries()].sort((a, b) => a[0] - b[0])) {
    const ziel = await PDFDocument.create()
    // pdf-lib zaehlt ab null, die Seiten des Stapels ab eins.
    const kopien = await ziel.copyPages(
      quelle,
      seiten.map((s) => s - 1),
    )
    for (const seite of kopien) ziel.addPage(seite)
    const inhalt = Buffer.from(await ziel.save())

    const aufnahme = await alsBenutzer(benutzerId, (c) =>
      dokumentAufnehmen(
        c,
        ablage,
        {
          mandantId,
          belegart: 'rechnung',
          eingangskanal: geladen.kopf.eingangskanal as Eingangskanal,
          dateiname: `${geladen.kopf.dateiname} — Beleg ${belegNr}`,
          mime: 'application/pdf',
          inhalt,
        },
        benutzerId,
      ),
    )

    ergebnis.push({
      belegNr,
      dokumentId: aufnahme.dokumentId,
      dublette: aufnahme.dublette.istDublette,
    })
  }

  await alsBenutzer(benutzerId, (c) =>
    c.query(
      `update stapel set status = 'uebernommen', uebernommen_am = now() where id = $1`,
      [stapelId],
    ),
  )

  return ergebnis
}

export async function stapelVerwerfen(
  benutzerId: string,
  stapelId: string,
  grund: string,
): Promise<boolean> {
  if (grund.trim() === '') {
    throw new StapelAbgelehnt('Ein verworfener Stapel braucht eine Begründung.')
  }
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update stapel set status = 'verworfen', fehler = $2
        where id = $1 and status <> 'uebernommen'`,
      [stapelId, grund.trim()],
    )
    return (rowCount ?? 0) > 0
  })
}

/** Der Ablageschlüssel einer Stapelseite — für die Korrekturoberfläche. */
export function stapelseiteSchluessel(stapelId: string, seite: number): string {
  return `stapel/${stapelId}/seite-${seite}.webp`
}

/** Für den Aufruf innerhalb einer bestehenden Verbindung (Tests, Worker). */
export async function stapelSeitenMitClient(
  c: PoolClient,
  stapelId: string,
): Promise<Stapelseite[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select seite, trenner, beleg_nr, quelle, '' as auszug
       from stapel_seite where stapel_id = $1 order by seite`,
    [stapelId],
  )
  return rows.map((z) => ({
    seite: Number(z['seite']),
    trenner: Boolean(z['trenner']),
    belegNr: z['beleg_nr'] == null ? null : Number(z['beleg_nr']),
    quelle: String(z['quelle']),
    auszug: '',
  }))
}
