/**
 * Kontierung mit Split.
 *
 * Grundlage: Konzept 6. Eine Rechnung zerfällt in Zeilen — Konto, Betrag,
 * Steuersatz —, und je Zeile stehen Umlagefähigkeit, Umlageschlüssel,
 * Rücklagenentnahme und Beschlussbezug. Die Ordnungsgruppe steht dagegen am
 * Dokument: Sie ist pro Beleg eindeutig.
 *
 * Zwei Regeln sind hier nicht verhandelbar:
 *
 *   * **Summenzwang.** Σ betrag_brutto = rechnung_fakten.brutto. Eine
 *     Verletzung blockiert die Kontierungsstufe — nicht die Ampel, die
 *     Stufe. Ein halb kontierter Beleg darf nicht weitergereicht werden.
 *   * **Nur Konten des Kontenrahmens** des Objekts. Das verhindert
 *     Falschkontierung an der Stelle, an der sie entsteht (Konzept 20).
 */

import type { PoolClient } from 'pg'

export class KontierungAbgelehnt extends Error {}

export interface Kontierungszeile {
  id: string
  zeileNr: number
  kontoId: string
  kontonummer: string
  kontobezeichnung: string
  betragNetto: number
  steuersatz: number
  betragBrutto: number
  umlagefaehig: boolean
  umlageschluesselId: string | null
  umlageschluessel: string | null
  ruecklageEntnahme: boolean
  quelle: string
}

export interface Kontierungsstand {
  zeilen: Kontierungszeile[]
  /** Rechnungsbetrag laut Beleg. */
  rechnungsbetrag: number | null
  summe: number
  /** Was noch zu verteilen ist — negativ heißt: zu viel verteilt. */
  offen: number
  stimmt: boolean
}

function zahl(roh: unknown): number {
  const wert = Number(roh)
  return Number.isFinite(wert) ? wert : 0
}

export async function kontierungLaden(
  c: PoolClient,
  dokumentId: string,
): Promise<Kontierungsstand> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select k.id, k.zeile_nr, k.konto_id, k.betrag_netto, k.steuersatz,
            k.betrag_brutto, k.umlagefaehig, k.umlageschluessel_id,
            k.ruecklage_entnahme, k.quelle,
            ko.kontonummer, ko.bezeichnung as kontobezeichnung,
            u.name as umlageschluessel
       from kontierung k
       join konto ko on ko.id = k.konto_id
       left join umlageschluessel u on u.id = k.umlageschluessel_id
      where k.dokument_id = $1
      order by k.zeile_nr`,
    [dokumentId],
  )

  const { rows: fakten } = await c.query<{ brutto: string | null }>(
    'select brutto from rechnung_fakten where dokument_id = $1',
    [dokumentId],
  )

  const zeilen: Kontierungszeile[] = rows.map((z) => ({
    id: String(z['id']),
    zeileNr: Number(z['zeile_nr']),
    kontoId: String(z['konto_id']),
    kontonummer: String(z['kontonummer']),
    kontobezeichnung: String(z['kontobezeichnung']),
    betragNetto: zahl(z['betrag_netto']),
    steuersatz: zahl(z['steuersatz']),
    betragBrutto: zahl(z['betrag_brutto']),
    umlagefaehig: Boolean(z['umlagefaehig']),
    umlageschluesselId: z['umlageschluessel_id'] == null ? null : String(z['umlageschluessel_id']),
    umlageschluessel: z['umlageschluessel'] == null ? null : String(z['umlageschluessel']),
    ruecklageEntnahme: Boolean(z['ruecklage_entnahme']),
    quelle: String(z['quelle']),
  }))

  const rechnungsbetrag = fakten[0]?.brutto == null ? null : Number(fakten[0].brutto)
  const summe = Number(zeilen.reduce((s, z) => s + z.betragBrutto, 0).toFixed(2))
  const offen =
    rechnungsbetrag === null ? 0 : Number((rechnungsbetrag - summe).toFixed(2))

  return {
    zeilen,
    rechnungsbetrag,
    summe,
    offen,
    // Ein Cent Abweichung ist Rundung. Mehr nicht -- der Summenzwang ist
    // eine Gleichung, keine Schaetzung.
    stimmt: rechnungsbetrag !== null && Math.abs(offen) <= 0.01,
  }
}

/** Konten, die für dieses Objekt zulässig sind. */
export async function kontenFuerBeleg(
  c: PoolClient,
  dokumentId: string,
): Promise<Array<{ id: string; kontonummer: string; bezeichnung: string; umlagefaehig: boolean }>> {
  const { rows } = await c.query<{
    id: string
    kontonummer: string
    bezeichnung: string
    umlagefaehig_default: boolean
  }>(
    `select ko.id, ko.kontonummer, ko.bezeichnung, ko.umlagefaehig_default
       from dokument d
       join objekt o on o.id = d.objekt_id
       join konto ko on ko.kontenrahmen_id = o.kontenrahmen_id
      where d.id = $1 and ko.aktiv
      order by ko.kontonummer`,
    [dokumentId],
  )
  return rows.map((z) => ({
    id: z.id,
    kontonummer: z.kontonummer,
    bezeichnung: z.bezeichnung,
    umlagefaehig: z.umlagefaehig_default,
  }))
}

/**
 * Fügt eine Zeile hinzu.
 *
 * Der Bruttobetrag ist die Eingabe, netto wird gerechnet: So steht es auf dem
 * Beleg, und so summiert es sich gegen den Rechnungsbetrag. Umlagefähigkeit
 * und Umlageschlüssel kommen als Vorschlag aus dem Konto und sind je Zeile
 * überschreibbar (Konzept 6).
 */
export async function zeileHinzufuegen(
  c: PoolClient,
  dokumentId: string,
  eingabe: {
    kontoId: string
    betragBrutto: number
    steuersatz: number
    umlagefaehig?: boolean | null
    umlageschluesselId?: string | null
    ruecklageEntnahme?: boolean
  },
): Promise<string> {
  const erlaubt = await kontenFuerBeleg(c, dokumentId)
  if (!erlaubt.some((k) => k.id === eingabe.kontoId)) {
    throw new KontierungAbgelehnt(
      'Dieses Konto gehört nicht zum Kontenrahmen des Objekts.',
    )
  }
  if (!Number.isFinite(eingabe.betragBrutto) || eingabe.betragBrutto === 0) {
    throw new KontierungAbgelehnt('Der Betrag fehlt.')
  }

  const netto = Number((eingabe.betragBrutto / (1 + eingabe.steuersatz / 100)).toFixed(2))

  const { rows } = await c.query<{ id: string }>(
    `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto, steuersatz,
                             betrag_brutto, umlagefaehig, umlageschluessel_id,
                             ruecklage_entnahme, quelle)
     select $1,
            coalesce((select max(zeile_nr) + 1 from kontierung where dokument_id = $1), 1),
            $2, $3, $4, $5,
            coalesce($6::boolean, ko.umlagefaehig_default),
            coalesce($7::uuid, ko.umlageschluessel_default_id),
            $8, 'mensch'
       from konto ko where ko.id = $2
     returning id`,
    [
      dokumentId,
      eingabe.kontoId,
      netto,
      eingabe.steuersatz,
      eingabe.betragBrutto,
      eingabe.umlagefaehig ?? null,
      eingabe.umlageschluesselId ?? null,
      eingabe.ruecklageEntnahme ?? false,
    ],
  )
  return rows[0].id
}

export async function zeileEntfernen(
  c: PoolClient,
  dokumentId: string,
  zeileId: string,
): Promise<void> {
  await c.query('delete from kontierung where id = $1 and dokument_id = $2', [
    zeileId,
    dokumentId,
  ])
}

export async function umlagefaehigkeitAendern(
  c: PoolClient,
  dokumentId: string,
  zeileId: string,
  umlagefaehig: boolean,
): Promise<void> {
  await c.query(
    'update kontierung set umlagefaehig = $3 where id = $1 and dokument_id = $2',
    [zeileId, dokumentId, umlagefaehig],
  )
}

/**
 * Verteilt den offenen Rest auf eine neue Zeile.
 *
 * Kein Rechenwerk, sondern die Abkürzung für den häufigsten Fall: Eine
 * Rechnung, die auf ein Konto geht, soll nicht zum Abtippen des Betrags
 * zwingen — dort entstehen die Zahlendreher.
 */
export async function restVerteilen(
  c: PoolClient,
  dokumentId: string,
  kontoId: string,
  steuersatz: number,
  umlageschluesselId: string | null = null,
): Promise<string | null> {
  const stand = await kontierungLaden(c, dokumentId)
  if (stand.rechnungsbetrag === null) {
    throw new KontierungAbgelehnt(
      'Ohne Rechnungsbetrag lässt sich kein Rest verteilen. Betrag erst erfassen.',
    )
  }
  if (Math.abs(stand.offen) <= 0.01) return null

  return zeileHinzufuegen(c, dokumentId, {
    kontoId,
    betragBrutto: stand.offen,
    steuersatz,
    umlageschluesselId,
  })
}

/**
 * Die harte Prüfung vor dem Stempel der Kontierungsstufe.
 *
 * Konzept 6: Verletzung des Summenzwangs blockiert die Stufe. Geprüft wird
 * über die Kontierung, **nicht** über die Zahlungszeilen — sonst verletzt der
 * Eigenanteil bei Selbstbeteiligung sie, weil derselbe Beleg zweimal zur
 * Zahlung geht (Konzept 13.1).
 */
export async function kontierungPruefen(
  c: PoolClient,
  dokumentId: string,
): Promise<string | null> {
  const stand = await kontierungLaden(c, dokumentId)

  if (stand.zeilen.length === 0) {
    return 'Der Beleg ist noch nicht kontiert.'
  }
  if (stand.rechnungsbetrag === null) {
    return 'Am Beleg fehlt der Rechnungsbetrag — der Summenzwang lässt sich nicht prüfen.'
  }
  if (!stand.stimmt) {
    return (
      `Die Kontierung ergibt ${stand.summe.toFixed(2)}, der Rechnungsbetrag ist ` +
      `${stand.rechnungsbetrag.toFixed(2)}. Es fehlen ${stand.offen.toFixed(2)}.`
    )
  }
  return null
}
