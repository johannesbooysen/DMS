# Analyse: der Amagno-Bestand der BHI

Grundlage ist das Workflow-Diagramm der Booysen Hausverwaltung & Immobilien
([amagno-bestand-workflow.svg](amagno-bestand-workflow.svg)) — Rechnungs-
eingang mit den Nebenläufen Klärung, Gutschrift, Bezahlen. Es
beschreibt den **Ist-Zustand des Systems, das abgelöst wird** — und damit den
Maßstab, an dem der Nachfolger gemessen wird.

Das Dokument ist Befund, kein Vorwurf. Die meisten Punkte unten sind keine
Bedienfehler, sondern Folgen der Bauweise: Amagno kennt keinen Ablauf, es
kennt Ordner mit Filtern. Wer damit einen Prozess bauen will, muss ihn aus
Filtern zusammensetzen — und bekommt genau die Eigenschaften, die hier
stehen.

Eine Stelle betrifft **uns**: Drei der vier Probleme, die in dem Diagramm rot
markiert sind, würde unsere heutige Ablaufprüfung ebenfalls nicht finden.
Siehe Abschnitt 4.

---

## 1. Der Ablauf steht nirgends

Ein Magnet ist ein gespeicherter Filter auf einem Ordner: *„zieh alles an,
worauf diese Bedingung passt."* Ein Beleg wandert nicht von Schritt zu
Schritt — er hängt sich an jeden Ordner, dessen Filter gerade passt.

Damit ist der Ablauf **emergent**. Nirgends steht „nach dem Rechnungseingang
kommt die Freigabe". Es ergibt sich:

```
Stempel „Rechnungseingang"  setzt Status = „Rechnungseingang abgeschlossen"
Magnet Ordner 01. Freigabe  fängt  Status = … UND Brutto ≥ 5000
```

Die Reihenfolge ist ein **Nebeneffekt** zweier voneinander unabhängig
gepflegter Einstellungen. Wer wissen will, was nach einem Stempel passiert,
muss alle Magneten gleichzeitig lesen und im Kopf auswerten.

**Der beste Beleg dafür ist das Diagramm selbst.** Es musste
zurückkonstruiert werden — es ist nicht der Ausdruck einer Konfiguration,
sondern die Rekonstruktion eines Verhaltens. Ein System, dessen Ablauf man
nur durch Nachzeichnen erfährt, kann man nicht ändern, ohne zu raten.

Bei uns ist der Blockbaum der Ablauf: lesbar, simulierbar, versioniert. Das
Diagramm ist dort kein Analyseergebnis, sondern die Ansicht.

## 2. Der Status ist die Steuerung — und es gibt ihn dreimal

Der eigentliche Programmzähler ist das Feld **Status**:
`Rechnungseingang abgeschlossen` → `Freigegeben` → `Sachlich geprüft` →
`Rechnerisch geprüft` → `Kostenstelle zugeordnet` → `Zahlung erfasst` →
`Zahlungsdaten geprüft` → `Bezahlt` → `Bezahlt & Archiviert`.

Eine einzelne Variable kann aber nur einen Zustand tragen. Sobald ein Beleg
gleichzeitig „in der rechnerischen Prüfung" und „in Klärung" ist, reicht sie
nicht — deshalb gibt es im Diagramm **zwei weitere**: `Status-Klärung` und
`Status-GS` (Gutschrift).

Das ist die eigentliche Ursache dafür, dass Klärung und Gutschrift im
Diagramm **neben** dem Hauptpfad stehen statt darin. Sie sind keine Zustände
des Vorgangs, sie sind Schattenprozesse mit eigener Statusvariablen. Und
jeder Magnet des Hauptpfads muss mitwissen, dass er Belege in einem
Schattenzustand nicht anziehen darf.

Jeder weitere Nebenlauf kostet eine vierte Variable und eine Erweiterung
**aller** bestehenden Magneten.

Bei uns ist das Warten ein Zustand des Laufs: Der Lauf steht auf `wartend`,
und er läuft weiter, wenn der **letzte** `wartecontainer` geschlossen ist —
mit Pflicht-Wiedervorlage und Pflicht-Ergebnis. Die Klärung ist damit
strukturell *innen*, nicht daneben.

## 3. Die Verzweigung steht zweimal und muss von Hand komplementär bleiben

```
Ordner 01. Freigabe          Magnet: Brutto ≥ 5000 ODER Technik ODER Mahnung
Ordner 02. Sachliche Prüfung Magnet: Brutto < 5000 + bestimmte OG
```

Zwei getrennte Filter, die zusammen genau einmal alles abdecken müssten.
Niemand prüft das. Wer die Grenze von 5.000 auf 3.000 ändert und den zweiten
Filter vergisst, bekommt Belege zwischen 3.000 und 5.000, die in **beiden**
Ordnern hängen — oder in **keinem**.

Der zweite Fall ist der gefährliche: Ein Beleg in keinem Ordner erzeugt keine
Fehlermeldung. Er liegt still. Das fällt auf, wenn eine Mahnung kommt.

Das Wort **„bestimmte OG"** im zweiten Magneten deutet darauf hin, dass die
Abdeckung heute schon nicht vollständig ist: Es ist eine Aufzählung, keine
Verneinung der ersten Bedingung. Eine neu angelegte Ordnungsgruppe fällt
dadurch in die Lücke — sie steht in keiner der beiden Listen.

**Empfehlung, unabhängig vom Nachfolger:** einmal auszählen, welche
Ordnungsgruppen in *keinem* der beiden Magneten stehen.

Bei uns ist eine Verzweigung **ein** Knoten mit **einer** Bedingung und zwei
Zweigen; die Prüfung weist eine Verzweigung mit nur einem Zweig als Fehler
aus. Ein Beleg kann strukturell nicht in die Lücke fallen.

## 4. Die drei roten Punkte sind ein einziges Problem — und es trifft uns auch

Im Diagramm rot markiert:

1. Stempel „Zahlung geprüft & i. O.": nur eine **Einzelperson** berechtigt
   (WS_9) statt der vorgesehenen Gruppe (WS_2).
2. Zwei Stempel sind **funktional tot** — niemand ist berechtigt:
   „Dokument obsolet", „E-Mailaktion – Versicherungsprämien".
3. Drei **Single Points of Failure**: Erstattungsprüfung, Zahlungsprüfung,
   Rechnungseingang hängen an je einer Person.

Das sind nicht drei Fehler, das ist dreimal dieselbe Lücke: **Die
Konfiguration wird nicht daraufhin geprüft, ob sie ausführbar ist.** Ein
Stempel, den niemand setzen darf, ist ein Ablauf, der an dieser Stelle
schweigend stehenbleibt. Das System meldet nichts — es hat gar keinen
Begriff davon, dass dort jemand hätte handeln sollen.

**Und hier ist der unangenehme Teil: Unsere Prüfung fände das ebenfalls
nicht.** `app.prozessbaum_pruefen` hat sieben Befunde, und alle sind
strukturell — keine Wurzel, leerer Behälter, Verzweigung ohne Bedingung,
Stufe nicht eingehängt, Stufe doppelt. Keiner davon fragt:

- Trägt **irgendjemand** in diesem Haus das Recht auf die Stempel dieser
  Stufe? (→ Amagno-Problem 2)
- Löst die Zuständigkeit dieser Stufe auf **mindestens eine aktive** Person
  auf? (→ Amagno-Problem 2)
- Hängt sie an **genau einer**? (→ Amagno-Problem 3, als Warnung)

Das sind drei `exists`-Abfragen in einer Funktion, die es schon gibt. Der
Ertrag ist groß: Die drei Befunde, für die hier ein Mensch ein ganzes
Diagramm zurückkonstruieren musste, fielen beim Aktivieren an.

**Ein vierter Befund derselben Klasse steckt in unserem eigenen Schema.**
`vier_augen_pflicht` steht in zwei Tabellen — `prozessstufe` und
`stempeltyp` — und wird **nirgends ausgewertet**. Die Spalte wird beim
Versionieren gewissenhaft mitkopiert und hat keine Wirkung. Das ist genau
Amagno-Problem 1 in unserem Haus: eine Einstellung, die aussieht, als
schütze sie etwas.

Im Diagramm hat das eine konkrete Entsprechung: WS_3 steht sowohl bei
„01. Erfassung Hausbank" (als zusätzlich Berechtigter) als auch bei
„03. Zahlung ausführen". Ob dieselbe Person erfassen und ausführen darf, ist
eine fachliche Entscheidung — heute fällt sie niemand, sie ergibt sich.

## 5. Sechs Ordner für sechs Menschen

Die Verteilung läuft über das Datenfeld **Zuständig** (WS_1 … WS_6), und
jeder Wert braucht einen eigenen Ordner mit eigenem Magneten — im Diagramm
zweimal, für die sachliche und die rechnerische Prüfung. Ein siebter
Mitarbeiter kostet zwei Ordner, zwei Magneten und einen neuen Feldwert.

Die Schreibweise `WS-8` gegen `WS_x` im roten Kasten ist die Folge: Wenn ein
Feldwert die Verteilung steuert, ist ein Tippfehler ein Beleg, der nirgends
ankommt.

Bei uns löst die Stufe ihre Zuständigkeit zur Laufzeit auf
(`objektverantwortlich`, `rolle`, `gruppe`, `spezialgebiet`) — kein Ordner je
Person, kein Feldwert, der stimmen muss.

## 6. Der Rücksprung rollt den Status zurück, nicht die Entscheidungen

„Zahlungsdaten fehlerhaft" springt zurück auf `Kostenstelle zugeordnet`. Die
Statusvariable wird gesetzt — **die bereits gesetzten Stempel bleiben, wie
sie sind.**

Damit fehlt der Begriff, der im Rechnungslauf am meisten wiegt: dass eine
Freigabe **ungültig werden kann**, weil sich die Daten darunter geändert
haben. Korrigiert jemand nach der Freigabe der Geschäftsführung den Betrag,
den Kreditor oder das Objekt, trägt der Beleg weiterhin eine Freigabe — für
Zahlen, die niemand freigegeben hat.

Das ist aus meiner Sicht der **größte sachliche Unterschied**. Bei uns trägt
jeder Freigabestempel den `freigabe_hash` seines Datenstands (per Trigger,
nicht durch die Anwendung). Bricht er, schreibt die Engine je Stufe ein
Ereignis `verfallen`, öffnet die Aufgabe wieder und springt auf die erste
betroffene Stufe zurück. Die Freigabe verschwindet nicht — sie ist als
verfallen sichtbar.

## 7. Die Freigabe steht vor der Prüfung

Im Diagramm läuft der Pfad für Beträge ≥ 5.000 € so:

```
Rechnungseingang → 01. Freigabe (GF) → 02. Sachliche Prüfung → 03. Rechnerische Prüfung
```

Die Geschäftsführung gibt frei, **bevor** jemand bestätigt hat, dass die
Leistung erbracht und der Betrag richtig ist. Das kann gewollt sein — große
Posten früh sehen ist ein legitimer Wunsch. Es bedeutet aber, dass die
Freigabe keine Prüfung bestätigt, sondern eine Kenntnisnahme ist.

Für den Nachfolger ist das eine offene Frage, weil es mit Abschnitt 6
zusammenhängt: Eine frühe Freigabe steht dort besonders oft vor dem
Verfall, weil die Korrekturen der sachlichen und rechnerischen Prüfung erst
danach kommen. Entweder die Freigabe rückt hinter die Prüfung — oder sie
wird als „Kenntnisnahme" geführt, die kein Hash schützt. Beides ist
vertretbar; stillschweigend beides zugleich nicht.

## 8. Der Stempel ist dort auch das Eingabeformular

Zwei Stellen im Diagramm:

- „Stempel *Rechnungseingang*" setzt Status **und** Ordnungsgruppe **und**
  Objektdaten.
- „Stempel *Kostenstelle zuordnen*" erfasst Buchungs- und Daueraktendaten,
  danach folgt „Stempel *Kostenstelle zugeordnet*".

Ein Stempel ist dort der Moment, in dem Daten entstehen — und bei der
Kostenstelle zusätzlich ein **Anfangs- und ein Endmarker**, also ein
missbrauchtes „in Bearbeitung durch mich".

Das ist eine Bedienerwartung, die der Nachfolger ernst nehmen sollte: Wer
stempelt, will an derselben Stelle eintragen. Bei uns ist der Stempel die
Entscheidung und die Kontierung ein eigener Vorgang — auf dem Aufgaben-
bildschirm müssen beide nebeneinander liegen, sonst fühlt es sich nach zwei
Arbeitsgängen an, wo es heute einer war.

Der doppelte Stempel für Anfang und Ende ist dagegen etwas, das der
Nachfolger ersetzen sollte statt nachzubauen: „Wer bearbeitet das gerade"
gehört an die Aufgabe, nicht in die Stempelhistorie.

## 9. „Erledigt & Archiviert" ist im Diagramm als Sackgasse markiert

Ein Ausstieg aus der Klärung, der den Beleg beendet, ohne dass er Kontierung
oder Zahlung gesehen hat. Die Markierung stammt aus dem Diagramm selbst.

Fachlich gibt es den Fall (Rechnung war unberechtigt, Lieferant zieht
zurück). Er braucht aber einen **benannten Ausgang mit Grund**, sonst ist
später nicht unterscheidbar, ob ein Beleg erledigt wurde oder verloren ging.
Bei uns wäre das ein Storno mit Begründung, archiviert, im Bestand sichtbar.

## 10. Das Soll-Konzept ist bei uns gebaut — es fehlt ihm die zweite Hälfte

Der grüne Kasten unten will drei Felder automatisch füllen:

| Feld | künftig aus |
|---|---|
| Objektdaten | Lieferant + Verbrauchsstelle |
| Ordnungsgruppe | Lieferant-Default + Schlüsselworte |
| Zuständig | Objekt + Ordnungsgruppe |

Das deckt sich mit unserem Modell bis in die Einzelheiten:
`zuordnungs_merkmal` lernt je Mandant, und **deterministische Merkmale
(Kundennummer, Zählernummer, IBAN) schlagen immer Ähnlichkeit** — genau die
Verbrauchsstelle aus der Tabelle.

Was in dem Kasten fehlt, ist der Umgang mit dem Irrtum. Der Satz *„sobald
diese 3 Felder gesetzt sind, läuft die Magnetisierung automatisch wie heute
schon"* stimmt — auch dann, wenn die drei Felder falsch sind. Eine falsch
abgeleitete Ordnungsgruppe verteilt zuverlässig an die falsche Person, und
weil der Magnet deterministisch arbeitet, sieht das Ergebnis korrekt aus.

Die fehlende Hälfte ist die **Ampel**: `ampel_extraktion` (wie sicher war die
Erkennung) und `ampel_plausibilitaet` (passt das Ergebnis zusammen), dazu
zwei harte Rot-Fälle, die nicht nur färben, sondern anhalten — IBAN passt
nicht zum bekannten Kreditor, und Dublette. Automatik ohne Zweifelsanzeige
verlagert den Fehler nur nach hinten.

## 11. Aufbewahrung

Der Endzustand trägt „Archivendedatum + 10 Jahre (GoBD)" — pauschal.

Bei uns steht die Frist als Stammdatum in `aufbewahrungsfrist` und rechnet ab
**Jahresende** (§ 147 AO); ohne Eintrag zehn Jahre, nie kürzer. Wichtiger ist
die Gegenseite, die im Diagramm gar nicht vorkommt: **Nach Fristablauf darf
ein Beleg nicht länger liegen.** GoBD und DSGVO zeigen hier in dieselbe
Richtung, und ein Archiv ohne Löschseite erfüllt die zweite Hälfte nicht.

---

## Was das für den Entwurf ändert

Gegen [docs/entwurf-workflow-und-stempel.md](entwurf-workflow-und-stempel.md)
gelesen:

**Bestätigt.** Der Geltungsbereich als Bedingung statt als Schlüsselspalten
ist richtig: Die Auswahl läuft dort über Brutto, Ordnungsgruppe, Belegart
(Rechnung/Mahnung) und Technik — vier Merkmale, die in einem Ausdruck stehen
und nicht in vier Spalten. Die Zuordnungserklärung („welcher Ablauf gilt und
warum") ist genau die Auskunft, die heute fehlt und für die das Diagramm
gezeichnet werden musste.

**Neu, und wichtiger als gedacht.** Die Ausführbarkeitsprüfung aus
Abschnitt 4. Sie stand im Entwurf gar nicht, weil ich sie ohne den Bestand
nicht gesehen hätte. Sie ist billig und fängt drei Fehlerklassen ab, die
sonst still bleiben.

**Zu berichtigen.** Ich hatte den Kreditor als **Auswahlmerkmal des Ablaufs**
verstanden. Im Bestand ist er das nicht — er ist die **Quelle**, aus der
Objekt, Ordnungsgruppe und Zuständigkeit abgeleitet werden, und erst diese
drei steuern. Das sind zwei verschiedene Mechanismen. Siehe Frage 1 unten.

**Offen geblieben.** Zu den Stempeln gibt das Diagramm nichts her — es sagt,
welche Stempel es gibt und wer sie setzen darf, nicht, wo sie auf dem Blatt
landen. Die Fragen 5 bis 9 des Entwurfs bleiben unbeantwortet.

---

## Fragen, die jetzt zählen

**1. Kreditor: Auswahl oder Ableitung?** Das ist nach dieser Analyse die
wichtigste Frage.

- *Ableitung* (so wie heute): Der Kreditor füllt Objekt, Ordnungsgruppe und
  Zuständigkeit; der Ablauf wird über diese drei gewählt. Dann braucht
  `prozessdefinition` **keine** Kreditor-Dimension — es braucht gute
  Stammdaten am Kreditor. Das ist der kleinere Eingriff.
- *Auswahl*: Ein bestimmter Kreditor bekommt einen eigenen Ablauf,
  unabhängig von Ordnungsgruppe und Betrag.

Beides ist baubar, beides ist vertretbar — aber es sind verschiedene
Baustellen. Gibt es einen konkreten Lieferanten, der einen **anderen Weg**
gehen soll und nicht nur andere Felder?

**2. Ist die 5.000-€-Grenze noch richtig, und was ist mit den
Ordnungsgruppen, die in keinem der beiden Magneten stehen?** Ich würde das
gern einmal auszählen, bevor wir die Regel übernehmen — sonst bauen wir eine
Lücke nach.

**3. Freigabe vor oder nach der sachlichen Prüfung?** Siehe Abschnitt 7. Mit
verfallenden Freigaben ist die Reihenfolge keine Geschmacksfrage mehr.

**4. Darf dieselbe Person Zahlung erfassen und ausführen?** Heute ergibt es
sich (WS_3 steht an beiden Stellen). Ich würde `vier_augen_pflicht` scharf
schalten — dann muss die Antwort ausdrücklich sein.

**5. Wer vertritt die drei Einzelpersonen?** Erstattungsprüfung,
Zahlungsprüfung, Rechnungseingang. Für den Ausfall gibt es den
Notfallzugriff (befristet, mit Grund); für den Alltag gehört es in Gruppen
oder Rollen.

**6. Was passiert mit „Erledigt & Archiviert"?** Braucht es diesen Ausgang,
und wenn ja — mit welchen Gründen zur Auswahl?

**7. Soll „in Bearbeitung durch X" sichtbar sein?** Heute wird das über zwei
Stempel behelfsmäßig gelöst. Ich würde es an die Aufgabe hängen statt in die
Stempelhistorie.

Dazu stehen die Stempelfragen 5 bis 9 aus dem Entwurf weiter offen — die
beantwortet das Diagramm nicht.
