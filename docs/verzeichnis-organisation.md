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
