/**
 * Einordnung der Tabellen in Verarbeitungstaetigkeiten (Art. 30 DSGVO).
 *
 * WARUM DAS VON HAND STEHT UND NICHT ABGELEITET WIRD
 *
 * Der naheliegende Entwurf waere eine Heuristik ueber Spaltennamen: Was
 * `name`, `email` oder `iban` heisst, ist personenbezogen. Das waere hier
 * das dritte Mal, dass eine Heuristik ueber Bezeichner danebengreift -- die
 * `wege()`-Erkennung im Verfahrensdoku-Erzeuger hielt Objektakte und
 * Fehlerkorb fuer Eingangswege, und das war nur ein Absatz Text. Hier waere
 * es ein Rechtsdokument.
 *
 * Ob eine Spalte einen Personenbezug traegt, ist eine fachliche Beurteilung.
 * Also steht sie hier, von Hand, mit Begruendung -- und **die
 * Vollstaendigkeit wird geprueft**: Der Erzeuger vergleicht diese Listen mit
 * den `create table`-Anweisungen der Migrationen und bricht ab, wenn eine
 * Tabelle in keiner von beiden steht. Eine neue Tabelle kann damit nicht
 * stillschweigend hereinrutschen.
 *
 * Was hier NICHT steht: Rechtsgrundlage (Art. 6), Verantwortlicher,
 * Datenschutzbeauftragter, Empfaenger. Das sind rechtliche und
 * organisatorische Festlegungen und gehoeren nach
 * `docs/verzeichnis-organisation.md`.
 */

/**
 * Die Verarbeitungstaetigkeiten.
 *
 * `tabellen` ist die Bruecke zum Schema: Jede Tabelle gehoert genau einer
 * Taetigkeit -- oder der Liste ohne Personenbezug weiter unten.
 */
export const TAETIGKEITEN = [
  {
    id: 'belegverarbeitung',
    name: 'Belegverarbeitung und Buchhaltung',
    zweck:
      'Eingangsrechnungen und Schriftverkehr aufnehmen, sachlich und ' +
      'rechnerisch pruefen, freigeben, kontieren und die Zahlung ' +
      'vorbereiten.',
    betroffene: [
      'Beschaeftigte der Verwaltung (wer geprueft, freigegeben, kontiert hat)',
      'Personen, die in Belegen genannt werden (Rechnungsempfaenger, ' +
        'Ansprechpartner, Mieter in Schadensmeldungen)',
    ],
    daten: [
      'Belegdaten: Kreditor, Rechnungsnummer, Datum, Betraege, Leistungszeitraum',
      'Volltext der Belegseiten -- er kann beliebige personenbezogene Angaben ' +
        'enthalten, weil er aus dem Dokument stammt und nicht aus einem Formular',
      'Entscheidungen mit Zeitstempel und handelnder Person (Stempelereignisse)',
      'Freitexte aus Klaerungen und Vorgaengen',
    ],
    frist:
      'Aufbewahrungspflichtige Belege nach `aufbewahrungsfrist`, gerechnet ab ' +
      'Jahresende (§147 AO). Ohne Eintrag zehn Jahre. Danach Loeschung nach §24.5.',
    tabellen: [
      'aufgabe',
      'dokument',
      'dokument_beziehung',
      'dokument_datei',
      'dokument_lauf',
      'dokument_layer',
      'dokument_merkmal',
      'dokument_seite',
      'extraktion_feld',
      'klaerung',
      'kontierung',
      'kontierung_35a',
      'kontierungs_muster',
      'korrektur_ereignis',
      'plausibilitaet_befund',
      'rechnung_fakten',
      'schriftverkehr_fakten',
      'stapel',
      'stapel_seite',
      'stempel_ereignis',
      'verarbeitungsfehler',
      'vorgang',
      'wartecontainer',
      'zahlung',
      'zuordnungs_merkmal',
      'zuweisung_ereignis',
    ],
  },
  {
    id: 'eigentuemer_mieter',
    name: 'Eigentuemer- und Mieterdaten',
    zweck:
      'Zuordnung von Personen zu Einheiten und Zeitraeumen -- Grundlage der ' +
      'Mietersicht: Welcher Beleg geht wen etwas an, und in welchem Zeitraum.',
    betroffene: ['Eigentuemer', 'Mieter', 'Beiraete'],
    daten: [
      'Name, Anschrift, Kontaktdaten',
      'Zuordnung zu Einheit und Zeitraum (Mietzeit, Eigentumszeit)',
    ],
    frist:
      'Solange das Verhaeltnis besteht, danach nach den Fristen der Belege, ' +
      'auf die sich der Bezug auswirkt.',
    tabellen: ['person', 'person_bezug'],
  },
  {
    id: 'benutzerverwaltung',
    name: 'Benutzer-, Rechte- und Konfigurationsverwaltung',
    zweck:
      'Anmeldung, Zuweisung von Rollen und Zustaendigkeiten, Vertretung, ' +
      'befristeter Notfallzugriff -- und der Nachweis, wer wann welche ' +
      'Ablaufkonfiguration aktiviert hat.',
    betroffene: ['Beschaeftigte der Verwaltung'],
    daten: [
      'Name, dienstliche E-Mail-Adresse, Kennung des Anmeldeverfahrens',
      'Sitzungen mit Zeitpunkt und Ablauf; An- und Abmeldeereignisse',
      'Rollen, Zustaendigkeiten und deren Gueltigkeitszeitraeume',
      'Notfallzugriffe mit Grund und Frist -- **ohne Gesundheitsangaben**',
    ],
    frist:
      'Sitzungen und Anmeldeereignisse kurzfristig; Rollen- und ' +
      'Zustaendigkeitszuweisungen bleiben datiert erhalten, weil sie belegen, ' +
      'wer eine Freigabe erteilen durfte.',
    tabellen: [
      'anmelde_ereignis',
      'benachrichtigung',
      'benutzer',
      'benutzer_rolle_objekt',
      'delegation',
      'gruppe_mitglied',
      'notfallzugriff',
      'objekt_zustaendigkeit',
      'prozessdefinition_ereignis',
      'sitzung',
      'spezialgebiet_zustaendigkeit',
    ],
  },
  {
    id: 'geschaeftspartner',
    name: 'Geschaeftspartner und Eingangsquellen',
    zweck:
      'Kreditoren und ihre Bankverbindungen fuehren, Vertraege zuordnen, ' +
      'Belege aus ueberwachten Ordnern und Mailpostfaechern aufnehmen.',
    betroffene: [
      'Kreditoren, soweit natuerliche Personen oder Einzelunternehmen',
      'Ansprechpartner bei Kreditoren',
    ],
    daten: [
      'Firmierung, Anschrift, Kontaktdaten',
      'Bankverbindungen (IBAN) samt Verifizierungsstand -- Betrugsschutz',
      'Adressen ueberwachter Mailpostfaecher',
    ],
    frist: 'Nach den Fristen der Belege, die auf sie verweisen.',
    tabellen: [
      'eingang_geholt',
      'eingangsquelle',
      'kreditor',
      'kreditor_bankverbindung',
      'vertrag',
    ],
  },
  {
    id: 'externe_einsicht',
    name: 'Externe Belegeinsicht',
    zweck:
      'Zeitlich befristete Einsicht in ausgewaehlte Belege fuer Beiraete, ' +
      'Eigentuemer oder Dritte -- ohne Benutzerkonto, ueber einen Token.',
    betroffene: ['Empfaenger einer Einsichtsgewaehrung'],
    daten: [
      'Adresse des Empfaengers, Umfang und Gueltigkeit der Gewaehrung',
      'Zugriffsprotokoll: welcher Beleg wann abgerufen wurde, IP-Adresse',
    ],
    frist:
      'Gewaehrungen laufen mit ihrer Frist ab; das Zugriffsprotokoll bleibt ' +
      'als Nachweis erhalten, dass und was herausgegeben wurde.',
    tabellen: ['einsicht_gewaehrung', 'zugriff_protokoll'],
  },
  {
    id: 'ausgangspost',
    name: 'Ausgangspost',
    zweck:
      'Alles, was das Haus per Mail verlaesst: Rueckfragen, Reklamationen, ' +
      'Einsichtslinks, Tagesuebersichten. Kein Modul versendet selbst.',
    betroffene: ['Empfaenger der Nachrichten'],
    daten: [
      'Empfaengeradresse, Betreff, Text, Anlass, Sendezeitpunkt und Ergebnis',
      'Fluechtige Texte (Einsichts-Token) werden nach erfolgreichem Versand ' +
        'aus der Datenbank ersetzt',
    ],
    frist:
      'Als Nachweis des Schriftverkehrs nach den Fristen des jeweiligen ' +
      'Anlasses.',
    tabellen: ['ausgang'],
  },
  {
    id: 'archivierung',
    name: 'Archivierung, Einschraenkung und Loeschung',
    zweck:
      'Aufbewahrung nach GoBD, Einschraenkung der Verarbeitung bei ' +
      'Loeschanspruechen an aufbewahrungspflichtigen Belegen, Loeschung nach ' +
      'Fristablauf und ihr Nachweis.',
    betroffene: [
      'Alle vorgenannten Gruppen, soweit ihre Daten in archivierten Belegen stehen',
      'Antragsteller einer Einschraenkung',
    ],
    daten: [
      'Archivhash, Ablageschluessel und Fassung, Aufbewahrungsfrist',
      'Einschraenkungen mit Grund und Zeitpunkt',
      'Loeschprotokoll -- **ohne personenbezogene Daten**: Eines, das den ' +
        'Namen behaelt, hat nicht geloescht',
    ],
    frist:
      'Das Loeschprotokoll bleibt dauerhaft, weil eine Luecke im Archiv sonst ' +
      'nicht von einem Verlust zu unterscheiden waere.',
    tabellen: ['archiv_eintrag', 'einschraenkung', 'loeschung', 'verfahrensdokumentation'],
  },
]

/**
 * Tabellen ohne Personenbezug.
 *
 * Sie stehen hier **einzeln und mit Grund**, nicht als Rest. Eine
 * Restkategorie waere die Stelle, an der eine neue Tabelle mit
 * Personenbezug unbemerkt landet.
 */
export const OHNE_PERSONENBEZUG = {
  aufbewahrungsfrist: 'Fristen je Belegart, keine Personen.',
  bauteil: 'Technische Bauteile mit Gewaehrleistung; Lieferant ist ein Verweis.',
  belegmerkmal: 'Stammdatum: Merkmalsnamen.',
  betrieb_lebenszeichen: 'Dienstname, Zeitpunkt, Programmfassung.',
  einheit: 'Gebaeudestruktur: Nummer, Lage, Flaeche, Anteile.',
  gruppe: 'Stammdatum: Gruppennamen.',
  kontenrahmen: 'Stammdatum.',
  konto: 'Stammdatum: Sachkonten.',
  mandant: 'Das verwaltende Haus selbst.',
  objekt: 'Liegenschaft: Nummer, Bezeichnung, Anschrift des Objekts.',
  ordnungsgruppe: 'Stammdatum.',
  prozess_override: 'Abweichende Ablaufkonfiguration je Objekt.',
  prozessdefinition: 'Ablaufkonfiguration.',
  prozessknoten: 'Ablaufkonfiguration.',
  prozessstufe: 'Ablaufkonfiguration.',
  prozessstufe_stempeltyp: 'Ablaufkonfiguration.',
  rolle: 'Rollennamen -- die Zuweisung an Personen steht in benutzer_rolle_objekt.',
  rolle_recht: 'Rechte je Rolle.',
  spezialgebiet: 'Stammdatum.',
  stempel_recht: 'Welche Rolle welchen Stempel setzen darf.',
  stempeltyp: 'Stammdatum.',
  umlageschluessel: 'Stammdatum.',
  vorlage: 'Textvorlagen mit Platzhaltern; die Werte entstehen erst beim Fuellen.',
  zahlungsweg: 'Stammdatum.',
}
