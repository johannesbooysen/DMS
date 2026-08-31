/**
 * Der Versand.
 *
 * Hinter einem Interface, wie der KI-Anbieter und der Identitätsanbieter.
 * Eingerichtet wird er über `SMTP_URL`; fehlt sie, gibt es **keinen** Versand
 * — und das ist eine Auskunft, kein Ausfall. Das Ausgangsbuch zeigt dann
 * offene Einträge, die niemand abgeholt hat.
 *
 * Kein stiller Rückfall auf einen Testversand: Ein Postausgang, der in der
 * Entwicklung „funktioniert" und im Betrieb ins Leere schreibt, ist die
 * schlechteste aller Varianten.
 */

import { createTransport, type Transporter } from 'nodemailer'

export interface Nachricht {
  an: string
  betreff: string
  text: string
  anhang?: { name: string; inhalt: Buffer; mime: string }
}

export interface Versand {
  senden(nachricht: Nachricht): Promise<void>
}

export class VersandNichtEingerichtet extends Error {
  constructor() {
    super(
      'Es ist kein Postausgang eingerichtet. SMTP_URL und DMS_ABSENDER setzen ' +
        '(siehe docs/handbuch.md, Abschnitt Postausgang).',
    )
    this.name = 'VersandNichtEingerichtet'
  }
}

export class SmtpVersand implements Versand {
  readonly #transport: Transporter
  readonly #absender: string

  constructor(url: string, absender: string) {
    this.#transport = createTransport(url)
    this.#absender = absender
  }

  async senden(nachricht: Nachricht): Promise<void> {
    await this.#transport.sendMail({
      from: this.#absender,
      to: nachricht.an,
      subject: nachricht.betreff,
      text: nachricht.text,
      attachments:
        nachricht.anhang === undefined
          ? undefined
          : [
              {
                filename: nachricht.anhang.name,
                content: nachricht.anhang.inhalt,
                contentType: nachricht.anhang.mime,
              },
            ],
    })
  }
}

/**
 * Sammelt statt zu senden.
 *
 * Für Tests und für einen Betrieb, der zusehen will, bevor er sendet. Muss
 * ausdrücklich eingeschaltet werden — der Vorgabewert ist „kein Versand", und
 * dabei bleibt es.
 */
export class MerkVersand implements Versand {
  readonly gesendet: Nachricht[] = []
  async senden(nachricht: Nachricht): Promise<void> {
    this.gesendet.push(nachricht)
  }
}

let gewaehlt: Versand | null | undefined

export function versandAusUmgebung(): Versand | null {
  if (gewaehlt !== undefined) return gewaehlt

  const url = process.env['SMTP_URL']
  const absender = process.env['DMS_ABSENDER']

  if (url === undefined || url === '' || absender === undefined || absender === '') {
    gewaehlt = null
    return null
  }

  gewaehlt = new SmtpVersand(url, absender)
  return gewaehlt
}

/** Für Tests: die getroffene Wahl vergessen. */
export function versandZuruecksetzen(): void {
  gewaehlt = undefined
}

export function versandEingerichtet(): boolean {
  return versandAusUmgebung() !== null
}
