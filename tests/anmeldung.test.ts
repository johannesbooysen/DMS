/**
 * Tests der Anmeldung.
 *
 * Was hier geprüft wird, ist die Sicherheitsgrenze selbst — nicht, ob ein
 * Bildschirm etwas anzeigt. Drei Fragen tragen die Datei:
 *
 *   * Verfällt eine Sitzung wirklich, und zwar auch dann, wenn niemand
 *     aufräumt? Ablauf, Untätigkeit und Sperrung müssen **beim Auflösen**
 *     greifen, nicht erst in einem nächtlichen Lauf.
 *   * Kommt jemand herein, den niemand angelegt hat? Er darf nicht.
 *   * Lässt sich der Anmeldeweg umbiegen — durch ein verfälschtes
 *     Zustandscookie oder ein fremdes Weiterleitungsziel?
 *
 * Der Identitätsanbieter selbst wird nicht getestet: Signaturprüfung, state
 * und nonce macht `openid-client`, und ein Test dagegen würde die Bibliothek
 * prüfen, nicht unseren Code. Getestet wird alles, was danach kommt.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsAnmeldung, alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  anmeldungProtokollieren,
  identitaetAufloesen,
  sitzungAnlegen,
  sitzungAufloesen,
  sitzungBeenden,
  tokenErzeugen,
  zustandAuspacken,
  zustandVerpacken,
} from '../src/anmeldung/sitzung'
import { STANDARDZIEL, zielPruefen } from '../src/anmeldung/ziel'
import { anbieter, anbieterZuruecksetzen } from '../src/anmeldung'
import { EntwicklungsAnbieter } from '../src/anmeldung/entwicklung'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const ANNA_EMAIL = 'anna@example.invalid'
const BERND = '20000000-0000-0000-0000-000000000002'

process.env['DMS_SITZUNGS_GEHEIMNIS'] ??= 'geheimnis-nur-fuer-tests-mindestens-32-zeichen'

/** Direkter Zugriff für Aufräumen und für Prüfungen an der Tabelle. */
async function inDerDatenbank<T>(
  frage: string,
  werte: unknown[] = [],
): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

afterEach(async () => {
  await inDerDatenbank('delete from sitzung')
  await inDerDatenbank('delete from anmelde_ereignis')
  await inDerDatenbank(
    'update benutzer set anbieter = null, externe_kennung = null, letzte_anmeldung = null',
  )
  await inDerDatenbank('update benutzer set aktiv = true where not aktiv')
})

afterAll(poolSchliessen)

describe('Sitzung', () => {
  it('loest den eigenen Token auf', async () => {
    const token = await sitzungAnlegen(ANNA, 'entwicklung')
    expect(token).not.toBeNull()

    const angemeldet = await sitzungAufloesen(token as string)
    expect(angemeldet).toEqual({ benutzerId: ANNA, mandantId: MANDANT })
  })

  it('legt den Token nicht im Klartext ab', async () => {
    // Wer die Datenbank liest, darf sich damit nicht anmelden koennen.
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    const zeilen = await inDerDatenbank<{ token_hash: Buffer }>(
      'select token_hash from sitzung',
    )
    expect(zeilen).toHaveLength(1)
    expect(zeilen[0].token_hash.toString('utf8')).not.toContain(token)
    expect(zeilen[0].token_hash).toHaveLength(32)
  })

  it('kennt einen erfundenen Token nicht', async () => {
    await sitzungAnlegen(ANNA, 'entwicklung')
    expect(await sitzungAufloesen(tokenErzeugen())).toBeNull()
  })

  it('kennt den leeren Token nicht', async () => {
    expect(await sitzungAufloesen('')).toBeNull()
  })

  it('endet mit der Abmeldung', async () => {
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    await sitzungBeenden(token)
    expect(await sitzungAufloesen(token)).toBeNull()
  })

  it('protokolliert Anmeldung und Abmeldung', async () => {
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    await sitzungBeenden(token)

    const eintraege = await inDerDatenbank<{ ergebnis: string; benutzer_id: string }>(
      'select ergebnis, benutzer_id from anmelde_ereignis order by id',
    )
    expect(eintraege.map((e) => e.ergebnis)).toEqual(['erfolg', 'abmeldung'])
    expect(eintraege.every((e) => e.benutzer_id === ANNA)).toBe(true)
  })
})

describe('Eine Sitzung verfaellt', () => {
  it('nach Ablauf -- und wird dabei beendet, nicht nur uebergangen', async () => {
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    await inDerDatenbank(`update sitzung set laeuft_ab_am = now() - interval '1 minute'`)

    expect(await sitzungAufloesen(token)).toBeNull()

    // Der Unterschied ist wichtig: Eine nur uebergangene Sitzung bliebe
    // offen stehen und liesse sich mit einem mitgeschnittenen Token spaeter
    // weiterbenutzen, sobald jemand die Ablaufzeit verschiebt.
    const [zeile] = await inDerDatenbank<{ beendet_grund: string | null }>(
      'select beendet_grund from sitzung',
    )
    expect(zeile.beendet_grund).toBe('ablauf')
  })

  it('nach zu langer Untaetigkeit', async () => {
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    await inDerDatenbank(`update sitzung set letzte_aktivitaet = now() - interval '20 hours'`)

    expect(await sitzungAufloesen(token)).toBeNull()
    const [zeile] = await inDerDatenbank<{ beendet_grund: string | null }>(
      'select beendet_grund from sitzung',
    )
    expect(zeile.beendet_grund).toBe('untaetigkeit')
  })

  it('sofort, wenn der Benutzer gesperrt wird', async () => {
    // Das ist der Grund fuer die serverseitige Sitzung. Ein selbsttragendes
    // Token haette bis zum Ablauf weitergegolten -- ein gesperrter
    // Mitarbeiter haette bis zu zwoelf Stunden weitergearbeitet.
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    expect(await sitzungAufloesen(token)).not.toBeNull()

    await inDerDatenbank('update benutzer set aktiv = false where id = $1', [ANNA])
    expect(await sitzungAufloesen(token)).toBeNull()

    const [zeile] = await inDerDatenbank<{ beendet_grund: string | null }>(
      'select beendet_grund from sitzung',
    )
    expect(zeile.beendet_grund).toBe('widerruf')
  })

  it('haelt sich bei jeder Benutzung frisch', async () => {
    const token = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    await inDerDatenbank(`update sitzung set letzte_aktivitaet = now() - interval '2 hours'`)

    await sitzungAufloesen(token)

    const [zeile] = await inDerDatenbank<{ alt: boolean }>(
      `select letzte_aktivitaet < now() - interval '1 minute' as alt from sitzung`,
    )
    expect(zeile.alt).toBe(false)
  })

  it('laesst sich fuer einen Benutzer geschlossen widerrufen', async () => {
    const eins = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    const zwei = (await sitzungAnlegen(ANNA, 'entwicklung')) as string
    const fremd = (await sitzungAnlegen(BERND, 'entwicklung')) as string

    const anzahl = await alsAnmeldung(async (c) => {
      const { rows } = await c.query<{ sitzungen_widerrufen: number }>(
        'select app.sitzungen_widerrufen($1)',
        [ANNA],
      )
      return rows[0].sitzungen_widerrufen
    })

    expect(anzahl).toBe(2)
    expect(await sitzungAufloesen(eins)).toBeNull()
    expect(await sitzungAufloesen(zwei)).toBeNull()
    expect(await sitzungAufloesen(fremd)).not.toBeNull()
  })
})

describe('Wer keine Sitzung bekommt', () => {
  it('ein gesperrter Benutzer', async () => {
    await inDerDatenbank('update benutzer set aktiv = false where id = $1', [ANNA])
    expect(await sitzungAnlegen(ANNA, 'entwicklung')).toBeNull()
  })

  it('eine Kennung, zu der es niemanden gibt', async () => {
    expect(await sitzungAnlegen('00000000-0000-0000-0000-0000000000ff', 'entwicklung')).toBeNull()
  })
})

describe('Identitaet und Benutzer', () => {
  it('bindet beim ersten Mal ueber die E-Mail-Adresse', async () => {
    const gefunden = await identitaetAufloesen('entra', 'oid-anna', ANNA_EMAIL)
    expect(gefunden).toBe(ANNA)

    const [zeile] = await inDerDatenbank<{ anbieter: string; externe_kennung: string }>(
      'select anbieter, externe_kennung from benutzer where id = $1',
      [ANNA],
    )
    expect(zeile).toEqual({ anbieter: 'entra', externe_kennung: 'oid-anna' })
  })

  it('geht danach ueber die Kennung, nicht mehr ueber die Adresse', async () => {
    await identitaetAufloesen('entra', 'oid-anna', ANNA_EMAIL)
    // Neue Adresse, gleiche Kennung -- etwa nach einer Heirat. Der Zugang
    // muss bestehen bleiben; genau dafuer ist `oid` da und nicht die E-Mail.
    expect(await identitaetAufloesen('entra', 'oid-anna', 'anna.neuer-name@example.invalid'))
      .toBe(ANNA)
  })

  it('legt niemanden an, den es nicht gibt', async () => {
    // Sonst haette jeder im Microsoft-Mandanten mit dem ersten Versuch einen
    // Zugang, und die Rechtevergabe liefe der Anmeldung hinterher.
    expect(await identitaetAufloesen('entra', 'oid-fremd', 'fremd@example.invalid'))
      .toBeNull()
    const [{ n }] = await inDerDatenbank<{ n: string }>('select count(*) n from benutzer')
    expect(Number(n)).toBe(5)
  })

  it('verdraengt eine bestehende Identitaet nicht ueber dieselbe Adresse', async () => {
    await identitaetAufloesen('entra', 'oid-anna', ANNA_EMAIL)
    // Zweite Kennung, gleiche Adresse. Ginge das durch, koennte ein neu
    // angelegtes Konto mit derselben Adresse den bestehenden Zugang
    // uebernehmen.
    expect(await identitaetAufloesen('entra', 'oid-jemand-anderes', ANNA_EMAIL)).toBeNull()
  })

  it('bindet keinen gesperrten Benutzer', async () => {
    await inDerDatenbank('update benutzer set aktiv = false where id = $1', [ANNA])
    expect(await identitaetAufloesen('entra', 'oid-anna', ANNA_EMAIL)).toBeNull()
  })

  it('vergleicht die Adresse ohne Rücksicht auf Gross- und Kleinschreibung', async () => {
    expect(await identitaetAufloesen('entra', 'oid-anna', 'Anna@Example.Invalid')).toBe(ANNA)
  })

  it('merkt sich den Zeitpunkt der Anmeldung', async () => {
    await identitaetAufloesen('entra', 'oid-anna', ANNA_EMAIL)
    const [zeile] = await inDerDatenbank<{ da: boolean }>(
      'select letzte_anmeldung is not null as da from benutzer where id = $1',
      [ANNA],
    )
    expect(zeile.da).toBe(true)
  })
})

describe('Der Zustand zwischen Hinweg und Rueckweg', () => {
  const zustand = { state: 'abc', nonce: 'def', pkceVerifier: 'ghi', zurueckNach: '/postfach' }

  it('kommt unveraendert zurueck', () => {
    expect(zustandAuspacken(zustandVerpacken(zustand))).toEqual(zustand)
  })

  it('faellt auf, wenn jemand daran dreht', () => {
    const verpackt = zustandVerpacken(zustand)
    const [inhalt, signatur] = [
      verpackt.slice(0, verpackt.lastIndexOf('.')),
      verpackt.slice(verpackt.lastIndexOf('.') + 1),
    ]
    const gefaelscht = Buffer.from(
      JSON.stringify({ ...zustand, state: 'fremd' }),
      'utf8',
    ).toString('base64url')

    expect(zustandAuspacken(`${gefaelscht}.${signatur}`)).toBeNull()
    expect(inhalt).not.toBe(gefaelscht)
  })

  it('faellt auf, wenn die Signatur fehlt', () => {
    const verpackt = zustandVerpacken(zustand)
    expect(zustandAuspacken(verpackt.slice(0, verpackt.lastIndexOf('.')))).toBeNull()
  })

  it('vertraegt fehlende und unsinnige Werte', () => {
    expect(zustandAuspacken(undefined)).toBeNull()
    expect(zustandAuspacken('')).toBeNull()
    expect(zustandAuspacken('kein.punkt.getrennter.unsinn')).toBeNull()
  })
})

describe('Weiterleitungsziel', () => {
  it('laesst eigene Pfade durch', () => {
    expect(zielPruefen('/aufgabe/123')).toBe('/aufgabe/123')
    expect(zielPruefen('/postfach?filter=offen')).toBe('/postfach?filter=offen')
  })

  it('weist fremde Adressen ab', () => {
    for (const boese of [
      'https://fremd.example/',
      '//fremd.example/',
      String.raw`/\fremd.example`,
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(zielPruefen(boese)).toBe(STANDARDZIEL)
    }
  })

  it('leitet nicht auf die Anmeldung zurueck', () => {
    expect(zielPruefen('/anmeldung')).toBe(STANDARDZIEL)
    expect(zielPruefen('/anmeldung/auswahl')).toBe(STANDARDZIEL)
  })
})

describe('Anbieterwahl', () => {
  const vorher = { ...process.env }

  function umgebung(werte: Record<string, string | undefined>): void {
    for (const schluessel of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'DMS_ANMELDUNG']) {
      delete process.env[schluessel]
    }
    for (const [k, v] of Object.entries(werte)) {
      if (v !== undefined) process.env[k] = v
    }
    anbieterZuruecksetzen()
  }

  afterEach(() => {
    process.env = { ...vorher }
    anbieterZuruecksetzen()
  })

  it('nimmt Entra, sobald es eingerichtet ist', () => {
    umgebung({
      ENTRA_TENANT_ID: 'mandant',
      ENTRA_CLIENT_ID: 'client',
      ENTRA_CLIENT_SECRET: 'geheim',
      DMS_ANMELDUNG: 'entwicklung',
    })
    // Auch wenn die Entwicklungsanmeldung eingeschaltet ist: Eine
    // eingerichtete echte Anmeldung gewinnt immer.
    expect(anbieter().name).toBe('entra')
  })

  it('bricht ab, wenn gar nichts eingerichtet ist', () => {
    umgebung({})
    expect(() => anbieter()).toThrow(/Keine Anmeldung eingerichtet/)
  })

  it('nimmt die Entwicklungsanmeldung nur, wenn sie ausdruecklich eingeschaltet ist', () => {
    umgebung({ DMS_ANMELDUNG: 'entwicklung' })
    expect(anbieter().name).toBe('entwicklung')
  })

  it('nimmt sie im Betrieb auch dann nicht, wenn die Variable gesetzt ist', () => {
    // Der eigentliche Schutz. Eine Umgebungsvariable wandert beim Kopieren
    // einer Konfiguration mit -- irgendwann steht sie auf dem Server. Dann
    // muss NODE_ENV die zweite Sperre sein, und ein Abbruch ist die richtige
    // Antwort: lieber keine Anmeldung als eine offene Tuer.
    const alt = process.env.NODE_ENV
    try {
      umgebung({ DMS_ANMELDUNG: 'entwicklung' })
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
      anbieterZuruecksetzen()
      expect(() => anbieter()).toThrow(/Keine Anmeldung eingerichtet/)
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: alt, configurable: true })
    }
  })
})

describe('Entwicklungsanbieter', () => {
  const entwicklung = new EntwicklungsAnbieter()

  it('gibt einen Zustand mit eigenem state aus', async () => {
    const beginn = await entwicklung.beginnen('http://localhost:3000/rueck', '/postfach')
    expect(beginn.zustand.state).not.toBe('')
    expect(beginn.ziel).toContain(encodeURIComponent(beginn.zustand.state))
  })

  it('weist eine Antwort mit fremdem state ab', async () => {
    const beginn = await entwicklung.beginnen('http://localhost:3000/rueck', '/postfach')
    const antwort = new URL('http://localhost:3000/rueck?state=fremd&benutzer=' + ANNA_EMAIL)
    await expect(entwicklung.abschliessen(antwort, beginn.zustand, '')).rejects.toThrow()
  })

  it('liefert bei passendem state die gewaehlte Identitaet', async () => {
    const beginn = await entwicklung.beginnen('http://localhost:3000/rueck', '/postfach')
    const antwort = new URL(
      `http://localhost:3000/rueck?state=${encodeURIComponent(beginn.zustand.state)}` +
        `&benutzer=${encodeURIComponent(ANNA_EMAIL)}`,
    )
    const identitaet = await entwicklung.abschliessen(antwort, beginn.zustand, '')
    expect(identitaet.email).toBe(ANNA_EMAIL)
    expect(identitaet.anbieter).toBe('entwicklung')
  })
})

describe('Protokoll', () => {
  it('haelt einen vergeblichen Versuch ohne Benutzerbezug fest', async () => {
    await anmeldungProtokollieren('unbekannt', 'entra', 'kein_benutzer_zur_identitaet')
    const [zeile] = await inDerDatenbank<{
      ergebnis: string
      benutzer_id: string | null
      hinweis: string
    }>('select ergebnis, benutzer_id, hinweis from anmelde_ereignis')

    expect(zeile.ergebnis).toBe('unbekannt')
    expect(zeile.benutzer_id).toBeNull()
    // Keine E-Mail-Adresse im Protokoll: Der Eintrag wird laenger aufbewahrt
    // als eine Sitzung, und vergebliche Versuche duerfen daraus keine
    // Adressliste machen.
    expect(zeile.hinweis).not.toContain('@')
  })
})

describe('Sichtbarkeit der Sitzungen', () => {
  it('zeigt niemandem die Sitzungen eines anderen', async () => {
    await sitzungAnlegen(ANNA, 'entwicklung')
    await sitzungAnlegen(BERND, 'entwicklung')

    const annaSieht = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query('select benutzer_id from sitzung')
      return rows.map((r) => r.benutzer_id)
    })

    expect(annaSieht).toEqual([ANNA])
  })

  it('laesst niemanden eine Sitzung von Hand anlegen', async () => {
    // Sitzungen entstehen ausschliesslich ueber app.sitzung_anlegen. Ohne
    // insert-Policy laeuft das Statement ins Leere -- was hier zaehlt, ist,
    // dass hinterher keine Sitzung existiert.
    await expect(
      alsBenutzer(ANNA, (c) =>
        c.query(
          `insert into sitzung (benutzer_id, token_hash, laeuft_ab_am)
           values ($1, sha256('x'::bytea), now() + interval '1 day')`,
          [ANNA],
        ),
      ),
    ).rejects.toThrow()

    expect(await inDerDatenbank('select 1 from sitzung')).toHaveLength(0)
  })
})
