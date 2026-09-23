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

/**
 * Paragraf 35a EStG: haushaltsnahe Dienstleistung oder Handwerkerleistung.
 * Steuerlich zaehlt nur der Lohn- und Fahrtanteil, nie das Material -- und
 * nur, was unbar gezahlt wurde. Die Angaben haengen an der Zeile, weil ein
 * Beleg gemischt sein kann (Material auf ein Konto, Arbeit auf ein anderes).
 */
export const ARTEN_35A = ['haushaltsnah', 'handwerkerleistung'] as const
export type Art35a = (typeof ARTEN_35A)[number]
export const ART_35A_NAMEN: Record<Art35a, string> = {
  haushaltsnah: 'haushaltsnahe Dienstleistung',
  handwerkerleistung: 'Handwerkerleistung',
}

export interface Angaben35a {
  art: Art35a
  lohnanteil: number | null
  fahrtMaschinenkosten: number | null
  materialanteil: number | null
  unbarGezahlt: boolean
}

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
  /** Angaben nach Paragraf 35a EStG, wenn erfasst. */
  angaben35a: Angaben35a | null
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
            u.name as umlageschluessel,
            a.art as art_35a, a.lohnanteil, a.fahrt_maschinenkosten, a.materialanteil,
            a.unbar_gezahlt
       from kontierung k
       join konto ko on ko.id = k.konto_id
       left join umlageschluessel u on u.id = k.umlageschluessel_id
       left join kontierung_35a a on a.kontierung_id = k.id
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
    angaben35a:
      z['art_35a'] == null
        ? null
        : {
            art: String(z['art_35a']) as Art35a,
            lohnanteil: z['lohnanteil'] == null ? null : zahl(z['lohnanteil']),
            fahrtMaschinenkosten:
              z['fahrt_maschinenkosten'] == null ? null : zahl(z['fahrt_maschinenkosten']),
            materialanteil: z['materialanteil'] == null ? null : zahl(z['materialanteil']),
            unbarGezahlt: Boolean(z['unbar_gezahlt']),
          },
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

/**
 * Setzt oder entfernt die Angaben nach Paragraf 35a an einer Zeile.
 *
 * Geprueft wird gegen den Bruttobetrag der Zeile: Die Anteile duerfen ihn
 * zusammen nicht uebersteigen -- ein Lohnanteil ueber dem Rechnungsbetrag
 * ist ein Tippfehler, und der faellt sonst erst in der Abrechnung auf. Die
 * Zeile wird unter der RLS gelesen; eine fremde Zeile gibt es hier nicht.
 */
export async function angaben35aSetzen(
  c: PoolClient,
  dokumentId: string,
  zeileId: string,
  angaben: Angaben35a | null,
): Promise<void> {
  const { rows } = await c.query<{ betrag_brutto: string }>(
    'select betrag_brutto from kontierung where id = $1 and dokument_id = $2',
    [zeileId, dokumentId],
  )
  const zeile = rows[0]
  if (zeile === undefined) throw new KontierungAbgelehnt('Die Kontierungszeile gibt es nicht.')

  if (angaben === null) {
    await c.query('delete from kontierung_35a where kontierung_id = $1', [zeileId])
    return
  }
  if (!(ARTEN_35A as readonly string[]).includes(angaben.art)) {
    throw new KontierungAbgelehnt('Unbekannte Art nach Paragraf 35a.')
  }
  const anteil = (wert: number | null, name: string): number | null => {
    if (wert === null) return null
    if (!Number.isFinite(wert) || wert < 0) throw new KontierungAbgelehnt(`${name} muss ein Betrag ab 0 sein.`)
    return Number(wert.toFixed(2))
  }
  const lohn = anteil(angaben.lohnanteil, 'Der Lohnanteil')
  const fahrt = anteil(angaben.fahrtMaschinenkosten, 'Fahrt- und Maschinenkosten')
  const material = anteil(angaben.materialanteil, 'Der Materialanteil')
  const summe = (lohn ?? 0) + (fahrt ?? 0) + (material ?? 0)
  if (summe > Number(zeile.betrag_brutto) + 0.01) {
    throw new KontierungAbgelehnt(
      'Lohn, Fahrt und Material zusammen übersteigen den Betrag der Zeile.',
    )
  }
  await c.query(
    `insert into kontierung_35a (kontierung_id, art, lohnanteil, fahrt_maschinenkosten,
                                 materialanteil, unbar_gezahlt)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (kontierung_id) do update
       set art = excluded.art, lohnanteil = excluded.lohnanteil,
           fahrt_maschinenkosten = excluded.fahrt_maschinenkosten,
           materialanteil = excluded.materialanteil, unbar_gezahlt = excluded.unbar_gezahlt`,
    [zeileId, angaben.art, lohn, fahrt, material, angaben.unbarGezahlt],
  )
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
  /**
   * `null` heißt: wie im Konto hinterlegt. Der Kontierungsvorschlag gibt den
   * gelernten Wert mit — beim Bedienen sagte der Vorschlag „nicht
   * umlagefähig", und die Zeile war es dann doch, weil hier stumm die
   * Kontovorgabe griff. Ein Vorschlag, der etwas anderes tut, als er sagt,
   * ist schlimmer als keiner.
   */
  umlagefaehig: boolean | null = null,
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
    umlagefaehig,
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
