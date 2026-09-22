/**
 * Inbetriebnahmeprüfung — die Fragen, die sonst erst im Prüfungsfall
 * gestellt werden.
 *
 * Das System hat drei Säulen der Revisionssicherheit (Hash-Kette,
 * Objektsperre, Verfahrensdokumentation) und eine geprobte Wiederherstellung.
 * Jede davon lässt sich **stillschweigend** verfehlen: ein Eimer ohne Object
 * Lock sieht aus wie einer mit; eine Freigabe, die nie erfolgte, fehlt
 * einfach; eine Probe, die niemand lief, hinterlässt keine Spur. Nichts davon
 * stört den Betrieb. Es fehlt erst, wenn jemand danach fragt — und dann ist
 * es nicht mehr nachzuholen.
 *
 * Deshalb stellt dieses Modul die Fragen **vorher**, und zwar an das System
 * selbst, nicht an eine Checkliste: Es schreibt ein Objekt in den Eimer und
 * sperrt es, statt eine Konfiguration zu lesen; es rechnet den Hash der
 * Verfahrensdokumentation nach, statt nach einer Versionsnummer zu sehen;
 * es liest das Probenprotokoll, statt auf ein Datum im organisatorischen
 * Teil zu vertrauen.
 *
 * **Nichts vorgefunden ist nicht nichts.** Jeder Bereich sagt, was er
 * geprüft hat — auch wenn alles in Ordnung war. Eine Prüfung, die bei Erfolg
 * schweigt, ist von einer nicht gelaufenen nicht zu unterscheiden.
 *
 * Zwei Schweren: `hart` bedeutet, so geht es nicht in Betrieb; `weich` ist
 * ein Hinweis, der jemanden braucht, aber nicht heute.
 */

import { readdir } from 'node:fs/promises'
import type { PoolClient } from 'pg'
import type { S3Ablage } from '@/ablage-s3'
import { gesundheit, FRIST_S } from '@/betrieb'
import { letzteProbe } from '@/sicherung'
import { textHash } from '@/verfahrensdoku'

export type Schwere = 'hart' | 'weich'

export interface Befund {
  schwere: Schwere
  text: string
}

export interface Bereich {
  name: string
  /** Was angesehen wurde — je Zeile eine Tatsache, auch bei Erfolg. */
  geprueft: string[]
  befunde: Befund[]
}

const hart = (text: string): Befund => ({ schwere: 'hart', text })
const weich = (text: string): Befund => ({ schwere: 'weich', text })

/** Ab wann eine Probe als alt gilt. Empfohlener Turnus ist monatlich. */
export const PROBE_HOECHSTALTER_TAGE = 35

/** Wie lange die Probesperre im Objektspeicher hält. Kurz, damit das Objekt nicht zehn Jahre liegt. */
export const PROBESPERRE_S = 60

// ---------------------------------------------------------------------------
// 1. Umgebung
// ---------------------------------------------------------------------------

/**
 * Die Umgebungsvariablen — rein, ohne Netz, damit es sich testen lässt.
 *
 * Geprüft wird, was `.env.beispiel` verlangt, plus die zwei Fallen, die dort
 * nur als Kommentar stehen: die Entwicklungsanmeldung und die Adressform des
 * Objektspeichers. Hetzner beantwortet nur die Unterdomänenform; mit der
 * Vorgabe (Pfadform) schlägt jeder Zugriff fehl, und die Meldung des SDK
 * sagt nicht, warum.
 */
export function umgebungPruefen(env: Record<string, string | undefined>): Bereich {
  const befunde: Befund[] = []
  const geprueft: string[] = []
  const wert = (name: string): string => (env[name] ?? '').trim()
  const fehlt = (name: string): boolean => wert(name) === ''

  if (wert('DMS_ANMELDUNG') === 'entwicklung') {
    befunde.push(hart('DMS_ANMELDUNG=entwicklung -- die Entwicklungsanmeldung lässt jeden herein, ohne Passwort.'))
  } else {
    geprueft.push('Entwicklungsanmeldung aus')
  }

  for (const name of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']) {
    if (fehlt(name)) befunde.push(hart(`${name} fehlt -- ohne Entra kann sich niemand anmelden.`))
  }
  if (!fehlt('ENTRA_TENANT_ID') && !fehlt('ENTRA_CLIENT_ID') && !fehlt('ENTRA_CLIENT_SECRET')) {
    geprueft.push('Anmeldung über Entra ID eingerichtet')
  }

  const geheimnis = wert('DMS_SITZUNGS_GEHEIMNIS')
  if (geheimnis.length < 32) {
    befunde.push(hart('DMS_SITZUNGS_GEHEIMNIS fehlt oder ist kürzer als 32 Zeichen (openssl rand -hex 32).'))
  } else {
    geprueft.push('Sitzungsgeheimnis gesetzt')
  }

  const basis = wert('DMS_BASIS_URL')
  if (basis === '') {
    befunde.push(hart('DMS_BASIS_URL fehlt -- ohne sie entsteht keine Sammelmail, und die Anmeldung kennt ihre Rücksprungadresse nicht.'))
  } else if (!basis.startsWith('https://')) {
    befunde.push(hart(`DMS_BASIS_URL beginnt nicht mit https:// -- Sitzungscookies gehen sonst unverschlüsselt.`))
  } else {
    geprueft.push(`Basisadresse ${basis}`)
  }

  if (fehlt('DMS_S3_EIMER')) {
    befunde.push(hart('DMS_S3_EIMER fehlt -- ohne Objektspeicher gibt es keine Objektsperre, nur die Hash-Kette (ADR 0006).'))
  } else {
    if (fehlt('DMS_S3_SCHLUESSEL') || fehlt('DMS_S3_GEHEIMNIS')) {
      befunde.push(hart('DMS_S3_EIMER ist gesetzt, aber DMS_S3_SCHLUESSEL oder DMS_S3_GEHEIMNIS fehlt.'))
    }
    if (fehlt('DMS_S3_ENDPUNKT')) {
      befunde.push(hart('DMS_S3_ENDPUNKT fehlt -- ohne Endpunkt zeigt der Klient auf Amazon.'))
    }
    const endpunkt = wert('DMS_S3_ENDPUNKT')
    if (endpunkt.includes('your-objectstorage.com') && wert('DMS_S3_PFADFORM') !== 'nein') {
      befunde.push(hart('Hetzner beantwortet nur die Unterdomänenform: DMS_S3_PFADFORM=nein setzen.'))
    }
    if (endpunkt !== '' && !endpunkt.startsWith('https://')) {
      befunde.push(hart('DMS_S3_ENDPUNKT ist nicht https -- Belege gingen unverschlüsselt zum Speicher.'))
    }
    geprueft.push(`Objektspeicher ${wert('DMS_S3_EIMER')} an ${endpunkt || '(kein Endpunkt)'}`)
  }

  if (fehlt('SMTP_URL') || fehlt('DMS_ABSENDER')) {
    befunde.push(weich('SMTP_URL oder DMS_ABSENDER fehlt -- das Ausgangsbuch füllt sich, gesendet wird nichts.'))
  } else {
    geprueft.push('Postausgang eingerichtet')
  }

  if (fehlt('DMS_OCR')) {
    befunde.push(weich('DMS_OCR fehlt -- gescannte Belege ohne Textlayer bleiben ohne Erkennung (wird gemeldet, nicht verschwiegen).'))
  } else {
    geprueft.push(`Texterkennung ${wert('DMS_OCR')}`)
  }

  if (fehlt('DMS_FASSUNG')) {
    befunde.push(weich('DMS_FASSUNG fehlt -- das Lebenszeichen kann nicht sagen, welcher Stand läuft.'))
  } else {
    geprueft.push(`Fassung ${wert('DMS_FASSUNG')}`)
  }

  return { name: 'Umgebung', geprueft, befunde }
}

// ---------------------------------------------------------------------------
// 2. Objektspeicher
// ---------------------------------------------------------------------------

/**
 * Nicht die Konfiguration lesen, sondern es tun.
 *
 * Ein Objekt schreiben, sperren, mit seiner Fassung zurücklesen — derselbe
 * Weg, den ein archivierter Beleg geht, nur mit sechzig Sekunden Frist
 * statt zehn Jahren. Bricht einer der Schritte, ist der Eimer für dieses
 * System unbrauchbar, egal was die Konsole des Anbieters anzeigt.
 *
 * Das Probeobjekt bleibt liegen: Während der Sperre lässt es sich nicht
 * löschen, und danach ist es ein Textschnipsel unter `inbetriebnahme/`.
 */
export async function objektspeicherPruefen(ablage: S3Ablage, eimer: string): Promise<Bereich> {
  const befunde: Befund[] = []
  const geprueft: string[] = []

  const stand = await ablage.eimerPruefen()
  if (stand.objectLock === 'aus') {
    befunde.push(hart(`Eimer ${eimer} wurde ohne Object Lock angelegt -- nachträglich einschalten geht nicht; neuen Eimer anlegen.`))
  } else if (stand.objectLock === 'unbekannt') {
    befunde.push(weich('Die Object-Lock-Konfiguration ließ sich nicht abfragen; die Probe unten entscheidet.'))
  } else {
    geprueft.push('Object Lock am Eimer eingeschaltet')
  }
  if (stand.versionierung === 'aus') {
    befunde.push(hart('Versionierung ist aus -- ohne Fassungen schützt die Sperre nichts (ADR 0006).'))
  } else if (stand.versionierung === 'an') {
    geprueft.push('Versionierung eingeschaltet')
  }

  const zeit = new Date()
  const schluessel = `inbetriebnahme/${zeit.toISOString().replace(/[:.]/g, '-')}.txt`
  const inhalt = Buffer.from(`Inbetriebnahmeprobe ${zeit.toISOString()}\n`, 'utf8')

  try {
    await ablage.schreiben(schluessel, inhalt)
    geprueft.push('Probeobjekt geschrieben (mit SHA256-Prüfsumme)')
  } catch (fehler) {
    befunde.push(hart(`Schreiben abgewiesen: ${fehlername(fehler)}`))
    return { name: 'Objektspeicher', geprueft, befunde }
  }

  let fassung: string | null = null
  try {
    fassung = await ablage.sperren(schluessel, new Date(zeit.getTime() + PROBESPERRE_S * 1000))
  } catch (fehler) {
    befunde.push(hart(`Sperren im Compliance-Modus abgewiesen: ${fehlername(fehler)}`))
    return { name: 'Objektspeicher', geprueft, befunde }
  }
  if (fassung === null) {
    befunde.push(hart('Die Sperre hat keine Fassungskennung -- das Original wäre unzerstörbar und unauffindbar zugleich.'))
    return { name: 'Objektspeicher', geprueft, befunde }
  }
  geprueft.push(`Probeobjekt ${PROBESPERRE_S} s im Compliance-Modus gesperrt, Fassung festgehalten`)

  const bis = await ablage.sperrstand(schluessel, fassung)
  if (bis === null || bis.getTime() <= zeit.getTime()) {
    befunde.push(hart('Der Speicher meldet nach dem Sperren keine Sperre -- die Zusage ist nicht eingelöst.'))
  } else {
    geprueft.push('Sperre nachgelesen')
  }

  const zurueck = await ablage.lesen(schluessel, fassung).catch(() => null)
  if (zurueck === null || !zurueck.equals(inhalt)) {
    befunde.push(hart('Die gesperrte Fassung ließ sich nicht Byte für Byte zurücklesen.'))
  } else {
    geprueft.push('Gesperrte Fassung über ihre Kennung zurückgelesen')
  }

  return { name: 'Objektspeicher', geprueft, befunde }
}

// ---------------------------------------------------------------------------
// 3. Datenbank
// ---------------------------------------------------------------------------

export async function datenbankPruefen(c: PoolClient, migrationsverzeichnis: string | null): Promise<Bereich> {
  const befunde: Befund[] = []
  const geprueft: string[] = []

  const { rows: einstellungen } = await c.query<{ tz: string; ds: string }>(
    "select current_setting('timezone') as tz, current_setting('datestyle') as ds",
  )
  const e = einstellungen[0]
  if (e?.tz !== 'UTC') {
    befunde.push(weich(`Zeitzone der Datenbank ist ${e?.tz ?? '?'}, nicht UTC -- die Hashfunktionen nageln sie selbst fest, aber compose.yaml setzt sie als zweiten Riegel.`))
  } else {
    geprueft.push('Zeitzone UTC')
  }
  if (!(e?.ds ?? '').startsWith('ISO')) {
    befunde.push(weich(`DateStyle ist ${e?.ds ?? '?'}, nicht ISO.`))
  }

  const { rows: rollen } = await c.query("select 1 from pg_roles where rolname = 'dms_app'")
  if (rollen.length === 0) {
    befunde.push(hart('Die Rolle dms_app fehlt -- die Anwendung läuft dann als Eigentümer, und RLS greift nicht.'))
  } else {
    geprueft.push('Rolle dms_app vorhanden')
  }

  // Migrationen: jede Datei im Repository muss eingespielt sein.
  if (migrationsverzeichnis === null) {
    befunde.push(weich('Migrationsdateien nicht auffindbar -- ob alle eingespielt sind, ließ sich nicht prüfen.'))
  } else {
    const dateien = (await readdir(migrationsverzeichnis).catch(() => [] as string[]))
      .filter((d) => d.endsWith('.sql'))
      .map((d) => d.split('_')[0] ?? '')
    if (dateien.length === 0) {
      befunde.push(weich('Keine Migrationsdateien gefunden -- ob alle eingespielt sind, ließ sich nicht prüfen.'))
    } else {
      let eingespielt: string[] = []
      try {
        const { rows } = await c.query<{ version: string }>(
          'select version from supabase_migrations.schema_migrations',
        )
        eingespielt = rows.map((z) => z.version)
      } catch {
        befunde.push(hart('Keine Migrationstabelle -- diese Datenbank wurde noch nie migriert (supabase db push).'))
      }
      if (eingespielt.length > 0) {
        const fehlend = dateien.filter((v) => !eingespielt.includes(v))
        if (fehlend.length > 0) {
          befunde.push(hart(`${fehlend.length} Migration(en) nicht eingespielt, zuerst ${fehlend[0] ?? ''}.`))
        } else {
          geprueft.push(`Alle ${dateien.length} Migrationen eingespielt`)
        }
        const fremd = eingespielt.filter((v) => !dateien.includes(v))
        if (fremd.length > 0) {
          befunde.push(weich(`${fremd.length} eingespielte Migration(en) ohne Datei im Repository -- läuft hier ein anderer Stand?`))
        }
      }
    }
  }

  const { rows: schutz } = await c.query<{ gegenstand: string; befund: string }>(
    'select gegenstand, befund from app.schutz_pruefen()',
  )
  for (const z of schutz) befunde.push(hart(`${z.gegenstand}: ${z.befund}`))
  if (schutz.length === 0) geprueft.push('RLS, Policies und Unveränderlichkeitstrigger vollständig')

  const { rows: kette } = await c.query<{ folge: string; befund: string }>(
    'select folge, befund from app.kette_pruefen(500)',
  )
  for (const z of kette) befunde.push(hart(`Hash-Kette bei Ereignis ${z.folge}: ${z.befund}`))
  const { rows: zaehler } = await c.query<{ ereignisse: string; mandanten: string; verwalter: string }>(
    `select (select count(*) from stempel_ereignis) as ereignisse,
            (select count(*) from mandant) as mandanten,
            (select count(*) from rolle_recht where aktion = 'benutzer_verwalten') as verwalter`,
  )
  const n = zaehler[0]
  if (kette.length === 0) geprueft.push(`Hash-Kette über ${n?.ereignisse ?? 0} Stempelereignisse unversehrt`)

  if (Number(n?.mandanten ?? 0) === 0) {
    befunde.push(weich('Kein Mandant angelegt.'))
  } else if (Number(n?.verwalter ?? 0) === 0) {
    befunde.push(weich('Noch keine Rolle darf Benutzer verwalten -- npm run einrichten -- <mandant-id> weg|miet|se.'))
  } else {
    geprueft.push(`${n?.mandanten ?? 0} Mandant(en), Benutzerverwaltung vergeben`)
  }

  return { name: 'Datenbank', geprueft, befunde }
}

// ---------------------------------------------------------------------------
// 4. Verfahrensdokumentation
// ---------------------------------------------------------------------------

/**
 * Gibt es je Mandant eine freigegebene Fassung, und beschreibt sie **dieses**
 * System?
 *
 * Verglichen wird der Hash des frisch erzeugten Textes mit dem der letzten
 * Freigabe. Stimmt er nicht, würde jeder ab heute archivierte Beleg eine
 * Fassung tragen, die ein anderes Verfahren beschreibt — schlimmer als keine.
 */
export async function verfahrensdokuPruefen(
  c: PoolClient,
  aktuellerText: string | null,
  organisation: { verfahren: string | null; verzeichnis: string | null },
): Promise<Bereich> {
  const befunde: Befund[] = []
  const geprueft: string[] = []

  const { rows: mandanten } = await c.query<{ id: string; name: string }>('select id, name from mandant order by name')
  const { rows: fassungen } = await c.query<{ mandant_id: string; version: string; inhalt_hash: string }>(
    `select distinct on (mandant_id) mandant_id, version, inhalt_hash
       from verfahrensdokumentation
      order by mandant_id, gueltig_ab desc, freigegeben_am desc`,
  )
  const aktuell = aktuellerText === null ? null : textHash(aktuellerText)
  if (aktuell === null) {
    befunde.push(weich('Der Text der Verfahrensdokumentation ließ sich nicht erzeugen -- ob die Freigabe aktuell ist, bleibt offen.'))
  }

  for (const m of mandanten) {
    const f = fassungen.find((z) => z.mandant_id === m.id)
    if (f === undefined) {
      befunde.push(hart(`Mandant „${m.name}“: keine freigegebene Verfahrensdokumentation (npm run verfahrensdoku:freigeben).`))
    } else if (aktuell !== null && f.inhalt_hash !== aktuell) {
      befunde.push(hart(`Mandant „${m.name}“: Fassung ${f.version} beschreibt nicht den laufenden Stand -- neu erzeugen und freigeben.`))
    } else {
      geprueft.push(`Mandant „${m.name}“: Fassung ${f.version}${aktuell === null ? '' : ' entspricht dem Repository'}`)
    }
  }

  const offen = (text: string | null): number => (text === null ? -1 : (text.match(/⬜/g) ?? []).length)
  const v = offen(organisation.verfahren)
  if (v < 0) befunde.push(weich('docs/verfahrensdoku-organisation.md nicht auffindbar.'))
  else if (v > 0) befunde.push(weich(`${v} offene Punkte im organisatorischen Teil der Verfahrensdokumentation.`))
  else geprueft.push('Organisatorischer Teil der Verfahrensdokumentation ohne offene Punkte')

  const z = offen(organisation.verzeichnis)
  if (z < 0) befunde.push(weich('docs/verzeichnis-organisation.md nicht auffindbar.'))
  else if (z > 0) befunde.push(weich(`${z} offene Punkte im Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO).`))
  else geprueft.push('Verzeichnis der Verarbeitungstätigkeiten ohne offene Punkte')

  return { name: 'Verfahrensdokumentation', geprueft, befunde }
}

// ---------------------------------------------------------------------------
// 5. Restore-Probe
// ---------------------------------------------------------------------------

export async function sicherungsprobePruefen(c: PoolClient): Promise<Bereich> {
  const befunde: Befund[] = []
  const geprueft: string[] = []

  const probe = await letzteProbe(c)
  if (probe === null) {
    befunde.push(hart('Nie eine Wiederherstellung geprobt -- ein Archiv ohne getesteten Restore ist kein Archiv (npm run sicherung, dann sicherung:pruefen).'))
    return { name: 'Restore-Probe', geprueft, befunde }
  }

  geprueft.push(`Letzte Probe ${probe.zeitpunkt} (vor ${probe.alterTage} Tagen), Sicherung vom ${probe.sicherungVom}`)
  if (probe.ergebnis === 'befunde') {
    befunde.push(hart(`Die letzte Probe endete mit ${probe.befunde} Befund(en) -- diese Sicherung ist unbrauchbar.`))
  } else if (probe.ergebnis === 'leer') {
    befunde.push(weich('Die letzte Probe hat weder Stempelereignisse noch Archiveinträge vorgefunden -- sie belegt Kette und Dateien nicht.'))
  } else {
    geprueft.push(`Getragen: ${probe.geprueft.ereignisse} Ereignisse, ${probe.geprueft.archiveintraege} Archiveinträge, ${probe.geprueft.dateien} Dateien nachgerechnet`)
  }
  if (probe.alterTage > PROBE_HOECHSTALTER_TAGE) {
    befunde.push(weich(`Die letzte Probe ist ${probe.alterTage} Tage alt; empfohlen ist monatlich.`))
  }

  return { name: 'Restore-Probe', geprueft, befunde }
}

// ---------------------------------------------------------------------------
// 6. Hintergrunddienste
// ---------------------------------------------------------------------------

export async function hintergrundPruefen(): Promise<Bereich> {
  const befunde: Befund[] = []
  const geprueft: string[] = []
  const g = await gesundheit()
  if (!g.datenbank) {
    befunde.push(hart('Die Datenbank ist unter der Anwendungsrolle nicht erreichbar.'))
    return { name: 'Hintergrunddienste', geprueft, befunde }
  }
  for (const d of g.dienste) {
    if (d.frisch) geprueft.push(`${d.dienst} läuft (Lebenszeichen vor ${d.alterS} s${d.fassung === null ? '' : `, Fassung ${d.fassung}`})`)
  }
  for (const name of g.verstummt) {
    befunde.push(weich(`Kein frisches Lebenszeichen von „${name}“ (Frist ${FRIST_S} s) -- noch nicht gestartet oder verstummt.`))
  }
  return { name: 'Hintergrunddienste', geprueft, befunde }
}

/** Nur der Name des Fehlers und ein kurzer Text -- keine Adressen, keine Schlüssel. */
function fehlername(fehler: unknown): string {
  const f = fehler as { name?: string; message?: string }
  const text = (f.message ?? '').replace(/https?:\/\/\S+/g, '<adresse>').slice(0, 160)
  return `${f.name ?? 'Fehler'}${text === '' ? '' : ` -- ${text}`}`
}

export function hatHarte(bereiche: Bereich[]): boolean {
  return bereiche.some((b) => b.befunde.some((f) => f.schwere === 'hart'))
}
