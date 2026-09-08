# Verzeichnis von Verarbeitungstätigkeiten

<!-- ERZEUGT von scripts/verzeichnis-erzeugen.mjs. Nicht von Hand ändern.
     Der organisatorische Teil steht in docs/verzeichnis-organisation.md,
     die Einordnung der Tabellen in scripts/verzeichnis-daten.mjs. -->

Nach Art. 30 DSGVO. Der technische Teil ist aus dem Repository abgeleitet;
der organisatorische Teil steht in
[verzeichnis-organisation.md](verzeichnis-organisation.md) und wird von Hand
gepflegt.

Dieser Abschnitt wird **von Hand gepflegt**. Er enthält, was sich nicht aus
dem Quelltext ableiten lässt: wer verantwortlich ist, auf welcher
Rechtsgrundlage verarbeitet wird, wer die Daten empfängt.

> **Noch nicht vollständig.** Die mit „⬜ offen" gekennzeichneten Punkte sind
> auszufüllen, bevor das Verzeichnis der Aufsichtsbehörde vorgelegt werden
> kann. Sie stehen hier ausgewiesen, statt zu fehlen — ein Verzeichnis mit
> einer benannten Lücke ist brauchbar, eines mit einer verschwiegenen nicht.

### Verantwortlicher

| | |
|---|---|
| Name und Anschrift | ⬜ offen |
| Vertreter | ⬜ offen |
| Datenschutzbeauftragter | ⬜ offen — Benennungspflicht nach Art. 37 DSGVO und §38 BDSG prüfen |

### Rechtsgrundlagen

Die Zuordnung je Tätigkeit ist eine rechtliche Beurteilung und gehört
ausgefüllt, nicht geraten. Vorgesehen ist:

| Tätigkeit | Rechtsgrundlage |
|---|---|
| Belegverarbeitung und Buchhaltung | Art. 6 Abs. 1 lit. b und c DSGVO (Vertrag, rechtliche Verpflichtung: §147 AO, GoBD) — ⬜ zu bestätigen |
| Eigentümer- und Mieterdaten | Art. 6 Abs. 1 lit. b DSGVO (Verwaltervertrag, Mietverhältnis) — ⬜ zu bestätigen |
| Benutzer-, Rechte- und Konfigurationsverwaltung | Art. 6 Abs. 1 lit. b DSGVO i. V. m. §26 BDSG (Beschäftigungsverhältnis) — ⬜ zu bestätigen |
| Geschäftspartner und Eingangsquellen | Art. 6 Abs. 1 lit. b und f DSGVO — ⬜ zu bestätigen |
| Externe Belegeinsicht | Art. 6 Abs. 1 lit. b und f DSGVO (Auskunftsrechte von Eigentümern und Beiräten) — ⬜ zu bestätigen |
| Ausgangspost | Art. 6 Abs. 1 lit. b und f DSGVO — ⬜ zu bestätigen |
| Archivierung, Einschränkung und Löschung | Art. 6 Abs. 1 lit. c DSGVO (Aufbewahrungspflichten) — ⬜ zu bestätigen |

### Empfänger

| Empfänger | Wofür | Stand |
|---|---|---|
| Steuerberatung | Übergabe kontierter Belege | ⬜ offen — Vertrag und Umfang |
| Kreditinstitut | Zahlungsanweisungen | ⬜ offen |
| Eigentümer, Beiräte, Mieter | Belegeinsicht nach §18 Abs. 4 WEG und Einsichtsrechten aus dem Mietverhältnis | im System abgebildet (externe Einsicht) |
| Hostinganbieter | Betrieb von Datenbank und Objektspeicher | ⬜ offen — Auftragsverarbeitungsvertrag nach Art. 28 DSGVO |
| Anbieter der Texterkennung und Extraktion | nur bei eingerichteter KI-Strecke | ⬜ offen — Konzept §24.6, einschließlich Ausschluss der Trainingsnutzung |

**Auftragsverarbeitung.** Für jeden Empfänger, der im Auftrag verarbeitet,
ist ein Vertrag nach Art. 28 DSGVO zu schließen. Das betrifft heute den
Hostinganbieter; sobald `DMS_OCR` oder `DMS_EXTRAKTION` auf einen externen
Dienst zeigt, auch diesen.

### Übermittlung an Drittländer

**Zurzeit keine vorgesehen.** Datenbank und Objektspeicher liegen in
Deutschland; die Texterkennung läuft im Worker auf demselben Server, die
Extraktion ist im Auslieferungsstand abgeschaltet (`DMS_EXTRAKTION` ohne
Wert).

Das ändert sich, sobald ein KI-Dienst außerhalb der EU eingerichtet wird.
Dann sind Rechtsgrundlage und Garantien nach Kapitel V DSGVO hier
nachzutragen — ⬜ offen, solange nichts eingerichtet ist.

### Betroffenenrechte

**Auskunft** (Art. 15): Der Bestand ist über Objekt, Person und Zeitraum
auffindbar; die Objektakte gibt einen vollständigen Auszug heraus.

**Löschung** (Art. 17) trifft auf Aufbewahrungspflichten. Der Vorrang ist im
System abgebildet und nicht dem Einzelfall überlassen: Ein Löschanspruch an
einem aufbewahrungspflichtigen Beleg führt zur **Einschränkung der
Verarbeitung** (Art. 18) — Kennzeichnung und Entzug aller Leserechte, für
alle, auch für den Objektverantwortlichen. Gelöscht wird nach Fristablauf,
und dann von selbst fällig gestellt.

**Verfahren und Fristen für die Bearbeitung von Anträgen:** ⬜ offen.

### Turnus der Überprüfung

Dieses Verzeichnis ist bei jeder Änderung des Verfahrens fortzuschreiben.
Der technische Teil erzeugt sich neu (`npm run verzeichnis`) und bricht ab,
wenn eine Tabelle nicht eingeordnet ist. Der organisatorische Teil hier
gehört **mindestens jährlich** durchgesehen — Datum der letzten Durchsicht:
⬜ offen.

---

## Die Verarbeitungstätigkeiten

### Belegverarbeitung und Buchhaltung

**Zweck der Verarbeitung**

Eingangsrechnungen und Schriftverkehr aufnehmen, sachlich und rechnerisch pruefen, freigeben, kontieren und die Zahlung vorbereiten.

**Kategorien betroffener Personen**

- Beschaeftigte der Verwaltung (wer geprueft, freigegeben, kontiert hat)
- Personen, die in Belegen genannt werden (Rechnungsempfaenger, Ansprechpartner, Mieter in Schadensmeldungen)

**Kategorien personenbezogener Daten**

- Belegdaten: Kreditor, Rechnungsnummer, Datum, Betraege, Leistungszeitraum
- Volltext der Belegseiten -- er kann beliebige personenbezogene Angaben enthalten, weil er aus dem Dokument stammt und nicht aus einem Formular
- Entscheidungen mit Zeitstempel und handelnder Person (Stempelereignisse)
- Freitexte aus Klaerungen und Vorgaengen

**Vorgesehene Fristen für die Löschung**

Aufbewahrungspflichtige Belege nach `aufbewahrungsfrist`, gerechnet ab Jahresende (§147 AO). Ohne Eintrag zehn Jahre. Danach Loeschung nach §24.5.

**Wo die Daten liegen** (26 Tabellen)

`aufgabe`, `dokument`, `dokument_beziehung`, `dokument_datei`, `dokument_lauf`, `dokument_layer`, `dokument_merkmal`, `dokument_seite`, `extraktion_feld`, `klaerung`, `kontierung`, `kontierung_35a`, `kontierungs_muster`, `korrektur_ereignis`, `plausibilitaet_befund`, `rechnung_fakten`, `schriftverkehr_fakten`, `stapel`, `stapel_seite`, `stempel_ereignis`, `verarbeitungsfehler`, `vorgang`, `wartecontainer`, `zahlung`, `zuordnungs_merkmal`, `zuweisung_ereignis`

### Eigentuemer- und Mieterdaten

**Zweck der Verarbeitung**

Zuordnung von Personen zu Einheiten und Zeitraeumen -- Grundlage der Mietersicht: Welcher Beleg geht wen etwas an, und in welchem Zeitraum.

**Kategorien betroffener Personen**

- Eigentuemer
- Mieter
- Beiraete

**Kategorien personenbezogener Daten**

- Name, Anschrift, Kontaktdaten
- Zuordnung zu Einheit und Zeitraum (Mietzeit, Eigentumszeit)

**Vorgesehene Fristen für die Löschung**

Solange das Verhaeltnis besteht, danach nach den Fristen der Belege, auf die sich der Bezug auswirkt.

**Wo die Daten liegen** (2 Tabellen)

`person`, `person_bezug`

### Benutzer-, Rechte- und Konfigurationsverwaltung

**Zweck der Verarbeitung**

Anmeldung, Zuweisung von Rollen und Zustaendigkeiten, Vertretung, befristeter Notfallzugriff -- und der Nachweis, wer wann welche Ablaufkonfiguration aktiviert hat.

**Kategorien betroffener Personen**

- Beschaeftigte der Verwaltung

**Kategorien personenbezogener Daten**

- Name, dienstliche E-Mail-Adresse, Kennung des Anmeldeverfahrens
- Sitzungen mit Zeitpunkt und Ablauf; An- und Abmeldeereignisse
- Rollen, Zustaendigkeiten und deren Gueltigkeitszeitraeume
- Notfallzugriffe mit Grund und Frist -- **ohne Gesundheitsangaben**

**Vorgesehene Fristen für die Löschung**

Sitzungen und Anmeldeereignisse kurzfristig; Rollen- und Zustaendigkeitszuweisungen bleiben datiert erhalten, weil sie belegen, wer eine Freigabe erteilen durfte.

**Wo die Daten liegen** (11 Tabellen)

`anmelde_ereignis`, `benachrichtigung`, `benutzer`, `benutzer_rolle_objekt`, `delegation`, `gruppe_mitglied`, `notfallzugriff`, `objekt_zustaendigkeit`, `prozessdefinition_ereignis`, `sitzung`, `spezialgebiet_zustaendigkeit`

### Geschaeftspartner und Eingangsquellen

**Zweck der Verarbeitung**

Kreditoren und ihre Bankverbindungen fuehren, Vertraege zuordnen, Belege aus ueberwachten Ordnern und Mailpostfaechern aufnehmen.

**Kategorien betroffener Personen**

- Kreditoren, soweit natuerliche Personen oder Einzelunternehmen
- Ansprechpartner bei Kreditoren

**Kategorien personenbezogener Daten**

- Firmierung, Anschrift, Kontaktdaten
- Bankverbindungen (IBAN) samt Verifizierungsstand -- Betrugsschutz
- Adressen ueberwachter Mailpostfaecher

**Vorgesehene Fristen für die Löschung**

Nach den Fristen der Belege, die auf sie verweisen.

**Wo die Daten liegen** (5 Tabellen)

`eingang_geholt`, `eingangsquelle`, `kreditor`, `kreditor_bankverbindung`, `vertrag`

### Externe Belegeinsicht

**Zweck der Verarbeitung**

Zeitlich befristete Einsicht in ausgewaehlte Belege fuer Beiraete, Eigentuemer oder Dritte -- ohne Benutzerkonto, ueber einen Token.

**Kategorien betroffener Personen**

- Empfaenger einer Einsichtsgewaehrung

**Kategorien personenbezogener Daten**

- Adresse des Empfaengers, Umfang und Gueltigkeit der Gewaehrung
- Zugriffsprotokoll: welcher Beleg wann abgerufen wurde, IP-Adresse

**Vorgesehene Fristen für die Löschung**

Gewaehrungen laufen mit ihrer Frist ab; das Zugriffsprotokoll bleibt als Nachweis erhalten, dass und was herausgegeben wurde.

**Wo die Daten liegen** (2 Tabellen)

`einsicht_gewaehrung`, `zugriff_protokoll`

### Ausgangspost

**Zweck der Verarbeitung**

Alles, was das Haus per Mail verlaesst: Rueckfragen, Reklamationen, Einsichtslinks, Tagesuebersichten. Kein Modul versendet selbst.

**Kategorien betroffener Personen**

- Empfaenger der Nachrichten

**Kategorien personenbezogener Daten**

- Empfaengeradresse, Betreff, Text, Anlass, Sendezeitpunkt und Ergebnis
- Fluechtige Texte (Einsichts-Token) werden nach erfolgreichem Versand aus der Datenbank ersetzt

**Vorgesehene Fristen für die Löschung**

Als Nachweis des Schriftverkehrs nach den Fristen des jeweiligen Anlasses.

**Wo die Daten liegen** (1 Tabellen)

`ausgang`

### Archivierung, Einschraenkung und Loeschung

**Zweck der Verarbeitung**

Aufbewahrung nach GoBD, Einschraenkung der Verarbeitung bei Loeschanspruechen an aufbewahrungspflichtigen Belegen, Loeschung nach Fristablauf und ihr Nachweis.

**Kategorien betroffener Personen**

- Alle vorgenannten Gruppen, soweit ihre Daten in archivierten Belegen stehen
- Antragsteller einer Einschraenkung

**Kategorien personenbezogener Daten**

- Archivhash, Ablageschluessel und Fassung, Aufbewahrungsfrist
- Einschraenkungen mit Grund und Zeitpunkt
- Loeschprotokoll -- **ohne personenbezogene Daten**: Eines, das den Namen behaelt, hat nicht geloescht

**Vorgesehene Fristen für die Löschung**

Das Loeschprotokoll bleibt dauerhaft, weil eine Luecke im Archiv sonst nicht von einem Verlust zu unterscheiden waere.

**Wo die Daten liegen** (4 Tabellen)

`archiv_eintrag`, `einschraenkung`, `loeschung`, `verfahrensdokumentation`

---

## Tabellen ohne Personenbezug

Diese Tabellen tragen keine personenbezogenen Daten. Sie stehen einzeln und
mit Grund, nicht als Rest — eine Restkategorie wäre die Stelle, an der eine
neue Tabelle mit Personenbezug unbemerkt landet.

| Tabelle | Warum ohne |
|---|---|
| `aufbewahrungsfrist` | Fristen je Belegart, keine Personen. |
| `bauteil` | Technische Bauteile mit Gewaehrleistung; Lieferant ist ein Verweis. |
| `belegmerkmal` | Stammdatum: Merkmalsnamen. |
| `betrieb_lebenszeichen` | Dienstname, Zeitpunkt, Programmfassung. |
| `einheit` | Gebaeudestruktur: Nummer, Lage, Flaeche, Anteile. |
| `gruppe` | Stammdatum: Gruppennamen. |
| `kontenrahmen` | Stammdatum. |
| `konto` | Stammdatum: Sachkonten. |
| `mandant` | Das verwaltende Haus selbst. |
| `objekt` | Liegenschaft: Nummer, Bezeichnung, Anschrift des Objekts. |
| `ordnungsgruppe` | Stammdatum. |
| `prozess_override` | Abweichende Ablaufkonfiguration je Objekt. |
| `prozessdefinition` | Ablaufkonfiguration. |
| `prozessknoten` | Ablaufkonfiguration. |
| `prozessstufe` | Ablaufkonfiguration. |
| `prozessstufe_stempeltyp` | Ablaufkonfiguration. |
| `rolle` | Rollennamen -- die Zuweisung an Personen steht in benutzer_rolle_objekt. |
| `rolle_recht` | Rechte je Rolle. |
| `spezialgebiet` | Stammdatum. |
| `stempel_recht` | Welche Rolle welchen Stempel setzen darf. |
| `stempeltyp` | Stammdatum. |
| `umlageschluessel` | Stammdatum. |
| `vorlage` | Textvorlagen mit Platzhaltern; die Werte entstehen erst beim Fuellen. |
| `zahlungsweg` | Stammdatum. |

---

## Vollständigkeit

Das Schema hat **75 Tabellen**. Jede ist genau einmal
eingeordnet — entweder in einer Tätigkeit oder in der Liste ohne
Personenbezug. Geprüft beim Erzeugen gegen die `create table`-Anweisungen
der Migrationen; fehlt eine, bricht `npm run verzeichnis` ab.

Zurzeit ist keine Tabelle offen.

---

## Technische und organisatorische Maßnahmen

Die Maßnahmen nach Art. 32 DSGVO sind im Einzelnen in der
[Verfahrensdokumentation](verfahrensdokumentation.md) beschrieben und dort
durch die Tests belegt, die sie prüfen. Die tragenden:

- **Row Level Security als Sicherheitsgrenze**, nicht als Zusatz: Jede
  Abfrage läuft unter der Rolle `dms_app` mit gesetzter Benutzerkennung,
  nie als Tabelleneigentümer.
- **Getrennte Lese- und Schreibrechte** je Stammdatentabelle; Rollen sind
  additiv, nie subtraktiv.
- **Einschränkung statt Löschung** bei Löschansprüchen an
  aufbewahrungspflichtigen Belegen — für alle sichtbar entzogen, der Vorgang
  bleibt nachweisbar.
- **Append-only mit Hash-Kette** für Stempelereignisse; Archivierte Belege
  sind durch Trigger festgeschrieben.
- **Unveränderlicher Objektspeicher** (S3 Object Lock, Compliance-Modus) für
  archivierte Originale.
- **Befristeter, begründeter und sichtbarer Notfallzugriff** statt stiller
  Rechteausweitung.
- **Keine personenbezogenen Daten in Logs und Fehlermeldungen** — Projektregel,
  in den Modulen an den Fangstellen vermerkt.
