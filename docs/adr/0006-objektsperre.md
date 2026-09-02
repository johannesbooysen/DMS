# ADR 0006 — Object Lock schützt Fassungen, nicht Schlüssel

**Status:** angenommen (2026-09-02)
**Betrifft:** `src/ablage.ts`, `src/ablage-s3.ts`, `src/archiv/objektsperre.ts`,
`supabase/migrations/20260902100000_objektsperre.sql`, alle Lesestellen des Originals

## Ausgangslage

Konzept §19 nennt zwei Säulen der Revisionssicherheit. Die erste, die
Hash-Kette, steht seit `20260831200000`: Sie **erkennt**, wenn eine Datei sich
geändert hat. Die zweite, unveränderlicher Speicher, fehlte — die Ablage war
ein Verzeichnis. Wer eine Datei überschrieb, wurde beim Archivhash ertappt,
aber das Original war weg.

Die Spalte `archiv_eintrag.storage_object_lock_bis` war schon da und leer.

## Was die Prüfung ergab

Der erste Entwurf ging von einer Annahme aus, die plausibel klingt und in
jeder Zusammenfassung von S3 Object Lock so steht: Eine gesperrte Datei lässt
sich nicht mehr überschreiben. Sie stand als Zusage im Modulkopf.

Ein Test gegen MinIO hat sie in der ersten Minute widerlegt. Object Lock
schützt **Fassungen**, nicht Schlüssel — Versionierung ist Voraussetzung, und
damit gilt:

| Handlung | Ergebnis |
|---|---|
| Gesperrte Datei überschreiben | **gelingt** — es entsteht eine zweite Fassung |
| Gewöhnlich lesen | liefert die zweite: den untergeschobenen Inhalt |
| Gesperrte Fassung lesen | liefert das Original, unversehrt |
| Gesperrte Fassung löschen | wird abgewiesen |

Die Zusage lautet also **Erhalt**, nicht Abweisung. Das ist ein Unterschied
mit Folgen: Ohne festgehaltene Fassungskennung ist das Original zugleich
unzerstörbar *und* unauffindbar — ein Schutz, den niemand einlöst. Ein Angriff
oder ein Fehler bliebe unbemerkt, bis jemand den Archivhash nachrechnet.

Hätte diese Frage jemand am Schreibtisch entschieden, wäre die falsche Antwort
in den Code gegangen und dort jahrelang stehen geblieben. Sie wäre erst bei
einer Betriebsprüfung aufgefallen — an dem Tag, an dem das Archiv beweisen
soll, was es zusagt.

## Entscheidung

**1. Die Fassung wird festgehalten.** Neue Spalte
`archiv_eintrag.storage_fassung`. Sie kommt beim Sperren aus dem Speicher und
geht bei jedem Lesen des Originals wieder mit — die Ablage bekommt dafür einen
zweiten, optionalen Parameter an `lesen`.

Der Parameter steht in `Ablage` und nicht erst in `SperrbareAblage`. Sonst
müsste jeder Aufrufer zuerst prüfen, welche Ablage er gerade hat, und wer es
vergäße, bekäme still die falschen Bytes. Das Verzeichnis ignoriert ihn; es
kennt keine Fassungen.

Geliefert wird die Fassung von den Abfragen, die ohnehin den Ablageschlüssel
holen (`originalSchluessel`, `app.einsicht_datei`, Export, Objektakte) — wer
den Schlüssel bekommt, bekommt die Fassung dazu und kann sie nicht vergessen.

**2. Gesperrt wird nach dem Archivieren, in einem eigenen Durchgang.** Nicht in
derselben Transaktion und nicht als Auftrag in der Warteschlange.

Im Compliance-Modus kann **niemand** eine Sperre aufheben, auch der
Wurzelbenutzer nicht. Eine Sperre für eine zurückgerollte Archivierung wäre
damit ein Fehler, den nie jemand behebt: Die Datei liegt bis zum Datum, und
kein Konto ändert daran etwas. Eine *fehlende* Sperre dagegen bleibt als leere
Spalte sichtbar und wird beim nächsten Durchgang nachgeholt.

Der Archiveintrag **ist** die Warteschlange (`storage_object_lock_bis is
null` heißt offen) — dasselbe Muster wie beim Ausgangsbuch, aus demselben
Grund: Ein zusätzlicher Auftrag wäre ein zweites Fehlerfenster für dieselbe
Sache. Nebenbei fällt der Nachlauf für Belege ab, die vor der Einrichtung des
Speichers archiviert wurden; sie brauchen kein eigenes Skript.

**3. Die Reihenfolge ist die eigentliche Regel: sperren, dann vermerken.**
Bricht es dazwischen ab, wird die Datei beim nächsten Durchgang erneut
gesperrt — unschädlich, dasselbe Datum ist keine Verkürzung. Andersherum
entstünde ein Vermerk über einen Schutz, den es nicht gibt, und den fände
niemand je wieder: Die Spalte ist ja gefüllt.

**4. Beide Spalten sind einmal setzbar, nie änderbar.** `null → Wert` ja,
`Wert → anderer Wert` nein, erzwungen im Trigger. Das spiegelt die Zusage des
Compliance-Modus in die Datenbank. Wären sie frei änderbar, könnte jemand ein
Sperrdatum eintragen, das im Speicher nie gesetzt wurde — ein Schutz auf dem
Papier ist schlimmer als keiner, weil danach niemand mehr nachsieht.

## Erwogen und verworfen

**Governance statt Compliance.** Bequemer: Ein Konto mit
`BypassGovernanceRetention` kann eine falsch gesetzte Sperre wieder lösen.
Genau das ist aber, was ein Angreifer mit Administratorrechten täte — und was
ein Prüfer ausschließen will. Der Modus, der einen Fehler verzeihen würde,
verzeiht auch den Angriff.

**Beim Lesen den Hash prüfen statt die Fassung zu pinnen.** Der Archivhash
liegt vor, ein Vergleich wäre möglich. Er *erkennt* aber nur — man hätte am
Ende die Auskunft, dass die Datei nicht stimmt, und keine richtige. Das Pinnen
kostet eine Textspalte und **repariert**. Der Hash bleibt daneben als
unabhängiger Nachweis; die beiden ersetzen einander nicht.

**Auch die Seitenbilder sperren.** Sie sind Ableitungen und werden bei Bedarf
neu erzeugt; der Archivhash läuft über das Original. Sie zu sperren hieße,
jedes neu gerenderte Vorschaubild bis zum Ende der Aufbewahrungsfrist
mitzuschleppen.

**Die Frist verlängerbar machen.** S3 ließe es zu (verkürzen nie). Es gibt
heute keinen Anlass: Die Frist kommt aus `aufbewahrungsfrist`, einem
Stammdatum. Wer sie verlängern will, ändert das Stammdatum — und braucht dann
eine Funktion, die auch im Speicher nachzieht. Eine halbe Lösung wäre hier
schlimmer als gar keine.

## Konsequenzen

- Ohne S3 läuft alles weiter, nur ungeschützt. Das steht an genau einer
  Stelle: Beide Spalten bleiben leer. Der Worker sagt es beim Start.
- Der Eimer muss **mit** Object Lock angelegt werden — nachträglich
  einschalten geht nicht. Das gehört in die Einrichtung, nicht in eine
  Fehlermeldung im Betrieb, und ist im Handbuch beschrieben.
- Eine im Compliance-Modus gesperrte Datei belegt Speicher bis zum Ende der
  Frist. Bei zehn Jahren und ~25.000 Belegen im Jahr ist das eingeplant; ein
  versehentlich gesperrter Testeimer dagegen lässt sich nicht mehr aufräumen.
  Deshalb legen die Tests je Lauf einen eigenen Eimer an und sperren nur
  Minuten.
- Die Tests brauchen MinIO. Fehlt es, wird die S3-Hälfte übersprungen und sagt
  das ausdrücklich — ein Test, der ohne Speicher stillschweigend grün wird,
  wäre schlimmer als keiner.
