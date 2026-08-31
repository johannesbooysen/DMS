/**
 * Wohin nach der Anmeldung?
 *
 * Eigene Datei, weil das die einzige Stelle ist, an der eine fremde Adresse
 * ins System kommen könnte — und weil sie ohne Next.js prüfbar sein soll.
 *
 * Ohne diese Prüfung wäre `/anmeldung?weiter=https://…` eine offene
 * Weiterleitung: Der Link sähe aus wie einer ins DMS, führte aber nach der
 * Anmeldung anderswohin — und der Anwender hätte bis dahin alles Vertrauen
 * in die Adresse gesetzt, die er angeklickt hat.
 */

export const STANDARDZIEL = '/postfach'

/** Steuerzeichen — in einem Pfad hat keines davon etwas zu suchen. */
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/

export function zielPruefen(roh: string | null | undefined): string {
  if (roh === null || roh === undefined || roh === '') return STANDARDZIEL

  // Muss mit einem Schrägstrich beginnen, aber nicht mit zweien:
  // `//fremd.example` ist eine Adresse mit weggelassenem Schema, keine
  // relative Angabe.
  if (!roh.startsWith('/') || roh.startsWith('//')) return STANDARDZIEL

  // `/\fremd.example` deuten manche Browser wie `//`.
  if (roh.includes('\\')) return STANDARDZIEL

  if (STEUERZEICHEN.test(roh)) return STANDARDZIEL

  // Auf die Anmeldung selbst zurückzuleiten ergibt eine Schleife.
  if (roh === '/anmeldung' || roh.startsWith('/anmeldung/')) return STANDARDZIEL

  return roh
}
