/**
 * Stammdatenpflege.
 *
 * **Was hier steht, ist die Anwendung der Regel — nicht die Regel.** Wer
 * schreiben darf, entscheiden die Policies (`20260903100000`): Fachliche
 * Stammdaten brauchen `stammdaten_pflegen`, Benutzer und Rollen brauchen
 * `benutzer_verwalten`. Jede Funktion hier läuft unter der Kennung des
 * Handelnden; niemand bekommt einen zweiten Weg an der RLS vorbei.
 *
 * Das war bis zu dieser Migration anders: Die Policies lauteten `for all`
 * mit reinem Mandantenfilter, jeder Benutzer konnte sich selbst die
 * Geschäftsleitungsrolle zuweisen. Aufgefallen ist es beim Bauen dieser
 * Masken — für eine Oberfläche war zu klären, wer sie benutzen darf.
 *
 * **Warum die Fehlermeldungen unterscheiden.** „Nicht erlaubt" und „geht
 * nicht" führen zu verschiedenen Handlungen: Das eine holt man sich beim
 * Vorgesetzten, das andere korrigiert man selbst. Eine gemeinsame Meldung
 * schickt jemanden auf die falsche Suche.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '@/db'

/**
 * Was aus einem Formular ankommt.
 *
 * Als einfache Abbildung und nicht als `FormData`: Die tsconfig kennt
 * bewusst keine Browser-Typen, weil der Anwendungscode auf dem Server
 * laeuft. Das Umwandeln geschieht in der Aktionsschicht -- dort, wo das
 * Formular ohnehin ankommt.
 */
export type Eingaben = Record<string, string | null | undefined>
type Wert = string | null | undefined

export class NichtErlaubt extends Error {}
export class NichtMoeglich extends Error {}

/**
 * Führt eine Schreibaktion aus und übersetzt das Schweigen der RLS.
 *
 * Eine Policy weist nicht ab — sie lässt die Zeile verschwinden. Ein
 * `update`, das niemand sehen darf, meldet Erfolg mit null Zeilen, und ein
 * `insert` ohne Recht wirft einen technischen Fehler über „row-level
 * security policy". Beides ist für einen Menschen unbrauchbar.
 *
 * Genau daran ist auch meine erste Messung gescheitert: Ich hielt „kein
 * Fehler" für „gelungen", bis ich die betroffenen Zeilen zählte.
 */
async function schreiben<T>(
  benutzerId: string,
  aktion: (c: PoolClient) => Promise<T>,
): Promise<T> {
  try {
    return await alsBenutzer(benutzerId, aktion)
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    if (text.includes('row-level security')) {
      throw new NichtErlaubt(
        'Dafür fehlt das Recht. Stammdaten pflegen darf, wer die Rolle mit ' +
          'diesem Recht trägt — Benutzer und Rollen sind davon getrennt.',
      )
    }
    if (text.includes('duplicate key')) {
      throw new NichtMoeglich('Diesen Eintrag gibt es bereits.')
    }
    if (text.includes('violates foreign key')) {
      throw new NichtMoeglich(
        'Der Eintrag hängt an etwas, das es nicht (mehr) gibt. Bitte die ' +
          'Auswahl prüfen.',
      )
    }
    throw fehler
  }
}

/** Null geänderte Zeilen heißt: Die RLS hat sie ausgeblendet, nicht: erledigt. */
function mussGewirktHaben(zeilen: number): void {
  if (zeilen === 0) {
    throw new NichtErlaubt(
      'Die Änderung hat nichts bewirkt — der Eintrag ist für Sie nicht ' +
        'änderbar. Meist fehlt das Recht zur Stammdatenpflege.',
    )
  }
}

const text = (w: Wert): string | null => {
  const s = String(w ?? '').trim()
  return s === '' ? null : s
}

const pflicht = (w: Wert, feld: string): string => {
  const s = text(w)
  if (s === null) throw new NichtMoeglich(`${feld} darf nicht leer sein.`)
  return s
}

const zahl = (w: Wert): number | null => {
  const s = text(w)
  if (s === null) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Objekte
// ---------------------------------------------------------------------------

export interface Objektzeile {
  id: string
  objektnummer: string
  bezeichnung: string
  adresse: string | null
  verwaltungsart: string
  eskalationsgrenze: number | null
  zustaendige: string[]
}

export async function objekteLaden(benutzerId: string): Promise<Objektzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select o.id, o.objektnummer, o.bezeichnung, o.adresse, o.verwaltungsart,
              o.eskalationsgrenze_brutto,
              coalesce(
                array_agg(b.name order by b.name)
                  filter (where b.name is not null), '{}') as zustaendige
         from objekt o
         left join objekt_zustaendigkeit z on z.objekt_id = o.id
              and z.gueltig_von <= current_date
              and (z.gueltig_bis is null or z.gueltig_bis >= current_date)
         left join benutzer b on b.id = z.benutzer_id
        group by o.id, o.objektnummer, o.bezeichnung, o.adresse,
                 o.verwaltungsart, o.eskalationsgrenze_brutto
        order by o.objektnummer`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      objektnummer: String(z['objektnummer']),
      bezeichnung: String(z['bezeichnung']),
      adresse: z['adresse'] == null ? null : String(z['adresse']),
      verwaltungsart: String(z['verwaltungsart']),
      eskalationsgrenze:
        z['eskalationsgrenze_brutto'] == null ? null : Number(z['eskalationsgrenze_brutto']),
      zustaendige: (z['zustaendige'] as string[] | null) ?? [],
    }))
  })
}

export async function objektAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const nummer = pflicht(f['objektnummer'], 'Die Objektnummer')
  const bezeichnung = pflicht(f['bezeichnung'], 'Die Bezeichnung')
  const art = pflicht(f['verwaltungsart'], 'Die Verwaltungsart')

  await schreiben(benutzerId, async (c) => {
    await c.query(
      `insert into objekt (mandant_id, objektnummer, bezeichnung, adresse,
                           verwaltungsart, eskalationsgrenze_brutto)
       values (app.mein_mandant(), $1, $2, $3, $4, $5)`,
      [nummer, bezeichnung, text(f['adresse']), art, zahl(f['eskalationsgrenze'])],
    )
  })
}

export async function objektAendern(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Das Objekt')
  const bezeichnung = pflicht(f['bezeichnung'], 'Die Bezeichnung')

  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update objekt set bezeichnung = $2, adresse = $3,
                         eskalationsgrenze_brutto = $4
        where id = $1`,
      [id, bezeichnung, text(f['adresse']), zahl(f['eskalationsgrenze'])],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

/*
 * Objekte werden nicht geloescht.
 *
 * An einem Objekt haengen Belege, Kontierungen und Archiveintraege. Ein
 * geloeschtes Objekt hiesse: Belege ohne Zuordnung, und die Frage "zu
 * welchem Haus gehoerte diese Rechnung" waere fuer immer unbeantwortbar.
 * Wer ein Objekt abgibt, beendet die Zustaendigkeiten -- die Belege bleiben.
 */

// ---------------------------------------------------------------------------
// Kreditoren und ihre Bankverbindungen
// ---------------------------------------------------------------------------

export interface Bankverbindung {
  id: string
  iban: string
  status: string
  bestaetigtVon: string | null
  bestaetigtAm: string | null
}

export interface Kreditorzeile {
  id: string
  name: string
  status: string
  banken: Bankverbindung[]
}

export async function kreditorenLaden(benutzerId: string): Promise<Kreditorzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select k.id, k.name, k.status,
              coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', b.id, 'iban', b.iban, 'status', b.status,
                  'bestaetigtVon', bv.name,
                  'bestaetigtAm', to_char(b.bestaetigt_am, 'YYYY-MM-DD'))
                order by b.erstmals_gesehen)
                filter (where b.id is not null), '[]'::jsonb) as banken
         from kreditor k
         left join kreditor_bankverbindung b on b.kreditor_id = k.id
         left join benutzer bv on bv.id = b.bestaetigt_von
        group by k.id, k.name, k.status
        order by k.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      status: String(z['status']),
      banken: z['banken'] as Bankverbindung[],
    }))
  })
}

export async function kreditorAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const name = pflicht(f['name'], 'Der Name')
  await schreiben(benutzerId, async (c) => {
    await c.query('insert into kreditor (mandant_id, name) values (app.mein_mandant(), $1)', [
      name,
    ])
  })
}

export async function kreditorAendern(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Der Kreditor')
  const name = pflicht(f['name'], 'Der Name')
  const status = pflicht(f['status'], 'Der Status')
  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      'update kreditor set name = $2, status = $3 where id = $1',
      [id, name, status],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

/**
 * Eine Bankverbindung bestätigen oder sperren.
 *
 * Über `app.bankverbindung_verifizieren` und nicht über ein `update`: Das
 * ist der Betrugsschutz aus Konzept §14, und die Datenbank hält fest, wer
 * die Aussage getroffen hat. Im Schadensfall wird genau danach gefragt.
 */
export async function bankverbindungEntscheiden(
  benutzerId: string,
  f: Eingaben,
): Promise<void> {
  const id = pflicht(f['id'], 'Die Bankverbindung')
  const verifiziert = String(f['entscheidung'] ?? '') === 'verifizieren'

  await schreiben(benutzerId, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>(
      'select app.bankverbindung_verifizieren($1, $2) as ok',
      [id, verifiziert],
    )
    if (rows[0]?.ok !== true) {
      throw new NichtMoeglich('Diese Bankverbindung ist nicht erreichbar.')
    }
  })
}

export async function bankverbindungAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const kreditorId = pflicht(f['kreditorId'], 'Der Kreditor')
  const iban = pflicht(f['iban'], 'Die IBAN').replace(/\s+/g, '').toUpperCase()

  // Eine grobe Formpruefung, ausdruecklich keine Pruefziffernrechnung: Die
  // Verifizierung ist die Handlung eines Menschen, nicht eine Rechnung. Was
  // hier abgewiesen wird, sind Tippfehler, nicht Betrug.
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) {
    throw new NichtMoeglich('Das sieht nicht wie eine IBAN aus.')
  }

  await schreiben(benutzerId, async (c) => {
    await c.query(
      `insert into kreditor_bankverbindung (kreditor_id, iban, status)
       values ($1, $2, 'neu')`,
      [kreditorId, iban],
    )
  })
}

// ---------------------------------------------------------------------------
// Konten, Zahlungswege, Ordnungsgruppen, Fristen
// ---------------------------------------------------------------------------

export interface Kontozeile {
  id: string
  nummer: string
  bezeichnung: string
  umlagefaehig: boolean
  aktiv: boolean
  rahmen: string
}

export async function kontenLaden(benutzerId: string): Promise<Kontozeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select k.id, k.kontonummer, k.bezeichnung, k.umlagefaehig_default, k.aktiv,
              r.name as rahmen
         from konto k join kontenrahmen r on r.id = k.kontenrahmen_id
        order by k.kontonummer`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      nummer: String(z['kontonummer']),
      bezeichnung: String(z['bezeichnung']),
      umlagefaehig: z['umlagefaehig_default'] === true,
      aktiv: z['aktiv'] === true,
      rahmen: String(z['rahmen']),
    }))
  })
}

export async function kontoAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const nummer = pflicht(f['nummer'], 'Die Kontonummer')
  const bezeichnung = pflicht(f['bezeichnung'], 'Die Bezeichnung')

  await schreiben(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      'select id from kontenrahmen order by name limit 1',
    )
    const rahmen = rows[0]?.id
    if (rahmen === undefined) {
      throw new NichtMoeglich(
        'Es gibt noch keinen Kontenrahmen. Ohne ihn hängt ein Konto an nichts.',
      )
    }
    await c.query(
      `insert into konto (kontenrahmen_id, kontonummer, bezeichnung, umlagefaehig_default)
       values ($1, $2, $3, $4)`,
      [rahmen, nummer, bezeichnung, f['umlagefaehig'] === 'ja'],
    )
  })
}

export async function kontoUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Das Konto')
  await schreiben(benutzerId, async (c) => {
    // Deaktivieren statt loeschen: An einem Konto haengen Kontierungszeilen
    // archivierter Belege. Geloescht waere die Frage "worauf wurde das
    // gebucht" unbeantwortbar (Projektregel: nie loeschen).
    const { rowCount } = await c.query('update konto set aktiv = not aktiv where id = $1', [id])
    mussGewirktHaben(rowCount ?? 0)
  })
}

export interface Zahlungswegzeile {
  id: string
  name: string
  art: string
  aktiv: boolean
}

export async function zahlungswegeLaden(benutzerId: string): Promise<Zahlungswegzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select id, name, art, aktiv from zahlungsweg order by name',
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      art: String(z['art']),
      aktiv: z['aktiv'] === true,
    }))
  })
}

export async function zahlungswegAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const name = pflicht(f['name'], 'Der Name')
  const art = pflicht(f['art'], 'Die Art')
  await schreiben(benutzerId, async (c) => {
    await c.query(
      'insert into zahlungsweg (mandant_id, name, art) values (app.mein_mandant(), $1, $2)',
      [name, art],
    )
  })
}

export async function zahlungswegUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Der Zahlungsweg')
  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      'update zahlungsweg set aktiv = not aktiv where id = $1',
      [id],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

export interface Ordnungsgruppenzeile {
  id: string
  name: string
  farbe: string | null
  aktiv: boolean
}

export async function ordnungsgruppenLaden(
  benutzerId: string,
): Promise<Ordnungsgruppenzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select id, name, farbe, aktiv from ordnungsgruppe order by name',
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      farbe: z['farbe'] == null ? null : String(z['farbe']),
      aktiv: z['aktiv'] === true,
    }))
  })
}

export async function ordnungsgruppeAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const name = pflicht(f['name'], 'Der Name')
  const kurzcode = pflicht(f['kurzcode'], 'Der Kurzcode')
  await schreiben(benutzerId, async (c) => {
    await c.query(
      `insert into ordnungsgruppe (mandant_id, name, kurzcode, farbe)
       values (app.mein_mandant(), $1, $2, $3)`,
      [name, kurzcode.toUpperCase(), text(f['farbe'])],
    )
  })
}

export async function ordnungsgruppeUmschalten(
  benutzerId: string,
  f: Eingaben,
): Promise<void> {
  const id = pflicht(f['id'], 'Die Ordnungsgruppe')
  await schreiben(benutzerId, async (c) => {
    // Nur deaktivieren, nie loeschen (Projektregel): An einer Gruppe haengt
    // die Sichtbarkeit archivierter Belege.
    const { rowCount } = await c.query(
      'update ordnungsgruppe set aktiv = not aktiv where id = $1',
      [id],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

export interface Fristzeile {
  id: string
  belegart: string
  jahre: number
  grund: string
  aktiv: boolean
}

export async function fristenLaden(benutzerId: string): Promise<Fristzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select id, belegart, jahre, grund, aktiv from aufbewahrungsfrist order by belegart',
    )
    return rows.map((z) => ({
      id: String(z['id']),
      belegart: String(z['belegart']),
      jahre: Number(z['jahre']),
      grund: String(z['grund']),
      aktiv: z['aktiv'] === true,
    }))
  })
}

export async function fristSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  const belegart = pflicht(f['belegart'], 'Die Belegart')
  const jahre = zahl(f['jahre'])
  const grund = pflicht(f['grund'], 'Die Begründung')

  if (jahre === null || jahre < 1 || jahre > 100) {
    throw new NichtMoeglich('Die Frist muss zwischen 1 und 100 Jahren liegen.')
  }

  await schreiben(benutzerId, async (c) => {
    await c.query(
      `insert into aufbewahrungsfrist (mandant_id, belegart, jahre, grund, aktiv)
       values (app.mein_mandant(), $1, $2, $3, true)
       on conflict (mandant_id, belegart)
       do update set jahre = excluded.jahre, grund = excluded.grund, aktiv = true`,
      [belegart, jahre, grund],
    )
  })
}

// ---------------------------------------------------------------------------
// Benutzer und Rollen -- das getrennte Recht
// ---------------------------------------------------------------------------

export interface Benutzerzeile {
  id: string
  name: string
  email: string
  aktiv: boolean
  mandantenweit: boolean
  rollen: string[]
  objekte: string[]
}

export async function benutzerLaden(benutzerId: string): Promise<Benutzerzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      // Mandantenweite Sicht ist heute keine Spalte mehr, sondern eine
      // Rollenzuweisung ohne Objekt. Der Platzhalter
      // `benutzer.globaler_objektzugriff` wurde vom Rollenmodell abgelöst
      // (20260830100000) -- er stand in meinem ersten Entwurf noch, und ein
      // Test hat es gefunden.
      `select b.id, b.name, b.email, b.aktiv,
              bool_or(bro.objekt_id is null and bro.rolle_id is not null)
                as mandantenweit,
              coalesce(array_agg(distinct r.name)
                filter (where r.name is not null), '{}') as rollen,
              coalesce(array_agg(distinct o.objektnummer)
                filter (where o.objektnummer is not null), '{}') as objekte
         from benutzer b
         left join benutzer_rolle_objekt bro on bro.benutzer_id = b.id
              and bro.gueltig_von <= current_date
              and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
         left join rolle r on r.id = bro.rolle_id
         left join objekt_zustaendigkeit oz on oz.benutzer_id = b.id
              and oz.gueltig_von <= current_date
              and (oz.gueltig_bis is null or oz.gueltig_bis >= current_date)
         left join objekt o on o.id = oz.objekt_id
        group by b.id, b.name, b.email, b.aktiv
        order by b.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      email: String(z['email']),
      aktiv: z['aktiv'] === true,
      mandantenweit: z['mandantenweit'] === true,
      rollen: (z['rollen'] as string[] | null) ?? [],
      objekte: (z['objekte'] as string[] | null) ?? [],
    }))
  })
}

export async function benutzerAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const name = pflicht(f['name'], 'Der Name')
  const email = pflicht(f['email'], 'Die E-Mail-Adresse')

  await schreiben(benutzerId, async (c) => {
    /*
     * Ohne `auth_id`. Die entsteht bei der ersten Anmeldung ueber Entra ID
     * -- `app.identitaet_aufloesen` verknuepft sie mit dem hier angelegten
     * Benutzer (ADR 0004). Ein hier eingetragener Wert waere geraten.
     */
    await c.query(
      'insert into benutzer (mandant_id, name, email) values (app.mein_mandant(), $1, $2)',
      [name, email],
    )
  })
}

export async function benutzerUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Der Benutzer')

  /*
   * Sich selbst zu sperren ist der Klassiker, mit dem sich jemand aus der
   * eigenen Anwendung aussperrt -- und danach kann niemand mehr Benutzer
   * verwalten, wenn er der Einzige mit dem Recht war.
   */
  if (id === benutzerId) {
    throw new NichtMoeglich('Sich selbst kann man nicht sperren.')
  }

  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query('update benutzer set aktiv = not aktiv where id = $1', [
      id,
    ])
    mussGewirktHaben(rowCount ?? 0)
  })
}

export interface Rollenzeile {
  id: string
  name: string
  kurzcode: string
  aktiv: boolean
  rechte: string[]
  traeger: number
}

export async function rollenLaden(benutzerId: string): Promise<Rollenzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select r.id, r.name, r.kurzcode, r.aktiv,
              coalesce(array_agg(distinct rr.aktion)
                filter (where rr.aktion is not null), '{}') as rechte,
              count(distinct bro.benutzer_id) as traeger
         from rolle r
         left join rolle_recht rr on rr.rolle_id = r.id
         left join benutzer_rolle_objekt bro on bro.rolle_id = r.id
              and bro.gueltig_von <= current_date
              and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
        group by r.id, r.name, r.kurzcode, r.aktiv
        order by r.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      kurzcode: String(z['kurzcode']),
      aktiv: z['aktiv'] === true,
      rechte: (z['rechte'] as string[] | null) ?? [],
      traeger: Number(z['traeger']),
    }))
  })
}

export async function rolleZuweisen(benutzerId: string, f: Eingaben): Promise<void> {
  const wem = pflicht(f['benutzerId'], 'Der Benutzer')
  const rolleId = pflicht(f['rolleId'], 'Die Rolle')
  const objektId = text(f['objektId'])

  await schreiben(benutzerId, async (c) => {
    await c.query(
      `insert into benutzer_rolle_objekt (benutzer_id, rolle_id, objekt_id, gueltig_von)
       values ($1, $2, $3, current_date)
       on conflict do nothing`,
      [wem, rolleId, objektId],
    )
  })
}

export async function rolleEntziehen(benutzerId: string, f: Eingaben): Promise<void> {
  const wem = pflicht(f['benutzerId'], 'Der Benutzer')
  const rolleId = pflicht(f['rolleId'], 'Die Rolle')

  await schreiben(benutzerId, async (c) => {
    /*
     * Beendet statt geloescht. Wer wann welche Rolle trug, ist die Antwort
     * auf "wer durfte das damals" -- und die wird gestellt, wenn ein alter
     * Beleg geprueft wird (Konzept 17: die Sichtbarkeit ist datiert).
     */
    const { rowCount } = await c.query(
      `update benutzer_rolle_objekt
          set gueltig_bis = current_date - 1
        where benutzer_id = $1 and rolle_id = $2
          and (gueltig_bis is null or gueltig_bis >= current_date)`,
      [wem, rolleId],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

export async function zustaendigkeitSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  const wem = pflicht(f['benutzerId'], 'Der Benutzer')
  const objektId = pflicht(f['objektId'], 'Das Objekt')

  await schreiben(benutzerId, async (c) => {
    await c.query(
      // `art` ist Pflicht. Die Maske vergibt die Hauptverantwortung -- eine
      // Vertretung entsteht über die Delegation mit Zeitfenster und nicht
      // hier, weil sie keine Rechte überträgt (Konzept §17).
      `insert into objekt_zustaendigkeit (objekt_id, benutzer_id, art, gueltig_von)
       values ($1, $2, 'hauptverantwortlich', current_date)
       on conflict do nothing`,
      [objektId, wem],
    )
  })
}

export async function zustaendigkeitBeenden(benutzerId: string, f: Eingaben): Promise<void> {
  const wem = pflicht(f['benutzerId'], 'Der Benutzer')
  const objektId = pflicht(f['objektId'], 'Das Objekt')

  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update objekt_zustaendigkeit
          set gueltig_bis = current_date - 1
        where objekt_id = $1 and benutzer_id = $2
          and (gueltig_bis is null or gueltig_bis >= current_date)`,
      [objektId, wem],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

// ---------------------------------------------------------------------------
// Was der Handelnde darf
// ---------------------------------------------------------------------------

export interface Rechtelage {
  stammdaten: boolean
  benutzer: boolean
}

/**
 * Was darf der Angemeldete hier?
 *
 * Die Oberfläche fragt vorher, damit sie Formulare gar nicht erst zeigt, die
 * beim Absenden abgewiesen würden. **Das ist Bequemlichkeit, keine
 * Sicherheit** — die Grenze sind die Policies, und die greifen auch, wenn
 * jemand das Formular umgeht (Projektregel: Berechtigungsprüfung
 * serverseitig, nicht nur in der Oberfläche).
 */
export async function rechtelage(benutzerId: string): Promise<Rechtelage> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ s: boolean; b: boolean }>(
      `select app.darf('stammdaten_pflegen') as s, app.darf('benutzer_verwalten') as b`,
    )
    return { stammdaten: rows[0]?.s === true, benutzer: rows[0]?.b === true }
  })
}
