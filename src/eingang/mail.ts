/**
 * Mailpostfach als Eingangskanal.
 *
 * Zwei Teile, absichtlich getrennt:
 *
 *   * **Das Abholen** (IMAP) steckt hinter `Postfachzugang`. Es lässt sich
 *     ohne Mailserver nicht prüfen, und ein Test, der ohne Server
 *     stillschweigend durchläuft, ist schlimmer als keiner.
 *   * **Die Entscheidung**, was aus einer Mail wird, ist reine Rechnung über
 *     einer geparsten Nachricht — und die trägt den Ertrag. Sie wird gegen
 *     erfundene Mails geprüft.
 *
 * Die Entscheidung selbst folgt Konzept 1: „Kein zweites Modul für
 * Schriftverkehr; ein Posteingang." Eine Mail mit Rechnungsanhang wird zur
 * Rechnung. Eine Mail **ohne** verwertbaren Anhang wird nicht weggeworfen,
 * sondern selbst zum Beleg — Schriftverkehr ist auch Post.
 */

import { simpleParser, type ParsedMail } from 'mailparser'
import {
  geheimnis,
  pflichtfeld,
  zahlenfeld,
  type Eingangsquelle,
  type Fundstueck,
  type Quelleneinstellungen,
} from './quelle'

/** Anhänge, aus denen ein Beleg werden kann. */
const BELEGTYPEN = new Set(['application/pdf', 'application/xml', 'text/xml'])

/**
 * Anhänge, die nie ein Beleg sind — auch wenn sie PDF heißen.
 *
 * Signaturbilder und eingebettete Logos kommen als Anhang mit `contentId`
 * und stecken in der Textdarstellung. Ohne diese Prüfung entstünde aus jeder
 * Mail einer Kanzlei ein Dutzend Belege aus Briefkopfgrafiken.
 */
function istZierat(anhang: ParsedMail['attachments'][number]): boolean {
  if (anhang.contentDisposition === 'inline') return true
  if (anhang.cid !== undefined && anhang.cid !== '') return true
  return false
}

export interface Nachricht {
  /** Für die Herkunftskennung. Fehlt sie, tritt die UID ein. */
  messageId: string
  roh: Buffer
}

export interface Postfachzugang {
  /**
   * Holt Nachrichten, die `bereitsGeholt` noch nicht kennt.
   *
   * Der Filter gehört hierher und nicht in den Aufrufer: Bei dreitausend
   * Mails im Postfach ist das der Unterschied zwischen einem Durchgang und
   * einem Vormittag.
   */
  nachrichten(
    einstellungen: Quelleneinstellungen,
    bereitsGeholt: (herkunft: string) => Promise<boolean>,
    hoechstzahl: number,
  ): Promise<Nachricht[]>
}

/**
 * Was aus einer Mail wird.
 *
 * Reine Rechnung über der geparsten Nachricht — der Teil, den Tests fassen
 * können.
 */
export async function fundstueckeAusMail(
  roh: Buffer,
  ersatzKennung: string,
): Promise<Fundstueck[]> {
  const mail = await simpleParser(roh)
  const kennung = mail.messageId ?? ersatzKennung
  const betreff = (mail.subject ?? '').trim()

  const belege: Fundstueck[] = []
  for (const anhang of mail.attachments) {
    if (istZierat(anhang)) continue
    if (!BELEGTYPEN.has(anhang.contentType)) continue

    const name = anhang.filename ?? `anhang-${belege.length + 1}.pdf`
    belege.push({
      // Message-Id **und** Anhangsname: Eine Mail mit zwei Rechnungen ergibt
      // zwei Belege, und beide muessen sich unterscheiden lassen.
      herkunft: `${kennung}#${name}`,
      dateiname: name,
      mime: anhang.contentType,
      inhalt: Buffer.from(anhang.content),
      hinweis: betreff === '' ? undefined : betreff,
    })
  }

  if (belege.length > 0) return belege

  /*
   * Keine verwertbaren Anhaenge -- die Mail selbst ist die Post.
   *
   * Sie stillschweigend zu ueberspringen waere der schlechteste Ausgang: Der
   * Absender hat geschrieben, im DMS steht nichts, und niemand erfaehrt es.
   * Als `.eml` aufgenommen ist sie im Posteingang sichtbar und ihr Text
   * durchsuchbar.
   */
  return [
    {
      herkunft: kennung,
      dateiname: `${dateinamenTauglich(betreff) || 'nachricht'}.eml`,
      mime: 'message/rfc822',
      inhalt: roh,
      hinweis: betreff === '' ? undefined : betreff,
    },
  ]
}

/** Aus einem Betreff einen Dateinamen machen, der auf jedem System trägt. */
export function dateinamenTauglich(text: string): string {
  return text
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * Der Klartext einer Mail, für Suche und Anzeige.
 *
 * HTML wird nicht gerendert, sondern verworfen: `mailparser` liefert zu einer
 * HTML-Mail auch eine Textfassung. Wo es die nicht gibt, bleibt der Betreff —
 * besser als eine Seite voll Auszeichnungen.
 */
export async function mailtext(roh: Buffer): Promise<string> {
  const mail = await simpleParser(roh)
  const teile = [
    mail.subject ?? '',
    typeof mail.from?.text === 'string' ? mail.from.text : '',
    typeof mail.to === 'object' && mail.to !== null && 'text' in mail.to
      ? String(mail.to.text)
      : '',
    mail.text ?? '',
  ]
  return teile
    .filter((t) => t.trim() !== '')
    .join('\n')
    .trim()
}

export const mailQuelle = (zugang: Postfachzugang): Eingangsquelle => ({
  art: 'mail',

  async holen(einstellungen, bereitsGeholt): Promise<Fundstueck[]> {
    const hoechstzahl = zahlenfeld(einstellungen, 'hoechstzahl', 25)
    const nachrichten = await zugang.nachrichten(einstellungen, bereitsGeholt, hoechstzahl)

    const alle: Fundstueck[] = []
    for (const n of nachrichten) {
      alle.push(...(await fundstueckeAusMail(n.roh, n.messageId)))
    }
    return alle
  },
})

/**
 * IMAP über `imapflow`.
 *
 * **Ungetestet gegen einen echten Server** — dafür bräuchte es einen, und ein
 * Test, der ohne Server durchläuft, sagt nichts. Geprüft ist alles, was
 * danach kommt: `fundstueckeAusMail`, `mailtext`, die Merkliste, der
 * Durchgang im Worker.
 *
 * Absichtlich **nicht** gelöscht und nicht verschoben: Die Merkliste
 * (`eingang_geholt`) trägt, dass nichts zweimal hereinkommt. Ein Programm,
 * das ungefragt in fremden Postfächern aufräumt, ist bei der ersten
 * Fehlkonfiguration ein Datenverlust. Wer möchte, setzt
 * `nach_dem_lesen: "gelesen"` — dann wird die Nachricht als gelesen
 * markiert, mehr nicht.
 */
export const imapZugang: Postfachzugang = {
  async nachrichten(einstellungen, bereitsGeholt, hoechstzahl): Promise<Nachricht[]> {
    const { ImapFlow } = await import('imapflow')

    const verbindung = new ImapFlow({
      host: pflichtfeld(einstellungen, 'host'),
      port: zahlenfeld(einstellungen, 'port', 993),
      secure: einstellungen['tls'] !== false,
      auth: {
        user: pflichtfeld(einstellungen, 'benutzer'),
        pass: geheimnis(einstellungen),
      },
      // Keine Protokollausgabe: Sie enthaelt Betreffzeilen und Adressen, und
      // in Logs gehoeren keine personenbezogenen Daten (Projektregel).
      logger: false,
    })

    const gefunden: Nachricht[] = []
    await verbindung.connect()
    try {
      const ordner = typeof einstellungen['ordner'] === 'string'
        ? String(einstellungen['ordner'])
        : 'INBOX'
      const schloss = await verbindung.getMailboxLock(ordner)
      try {
        for await (const nachricht of verbindung.fetch(
          { seen: false },
          { uid: true, envelope: true, source: true },
        )) {
          if (gefunden.length >= hoechstzahl) break

          const kennung = nachricht.envelope?.messageId ?? `uid:${nachricht.uid}`
          if (await bereitsGeholt(kennung)) continue
          if (nachricht.source === undefined) continue

          gefunden.push({ messageId: kennung, roh: Buffer.from(nachricht.source) })

          if (einstellungen['nach_dem_lesen'] === 'gelesen') {
            await verbindung.messageFlagsAdd({ uid: String(nachricht.uid) }, ['\\Seen'], {
              uid: true,
            })
          }
        }
      } finally {
        schloss.release()
      }
    } finally {
      await verbindung.logout()
    }

    return gefunden
  },
}
