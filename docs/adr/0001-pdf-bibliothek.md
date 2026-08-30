# 0001 · PDF-Bibliothek: pdfjs-dist statt pdfium

Stand: 28. August 2026 · angenommen

## Kontext

Das Konzept nennt in §13 ausdrücklich **pdfium** für den Textlayer und das
Vorrendern. Die Anforderungen dahinter sind:

- Text **mit Koordinaten**, weil jedes extrahierte Feld eine Fundstelle trägt
  und ein Klick im Formular an die Belegstelle springt (§5)
- Vorrendern **beim Eingang**, nicht bei der Anzeige — das ist die eigentliche
  Diagnose des Konzepts: nicht das Format ist der Engpass, sondern der
  Zeitpunkt der Verarbeitung (§1)
- Erste Seite unter 100 ms im Viewer, das PDF selbst nur per Range-Request
  beim Zoomen (§23)
- Belegte Textbereiche je Seite, damit die Stempelplatzierung den größten
  freien Block findet (§16)

Die Zielplattform ist Node unter Windows für die Entwicklung und Linux im
Betrieb. Eine Werkzeugkette mit Compiler auf dem Entwicklungsrechner ist
unerwünscht.

## Optionen

**pdfium über eine WASM-Bindung.** Für Node existiert pdfium praktisch nur als
WASM-Paket. Die verfügbaren Bindungen decken das Rendern ab; die Textschicht
(`FPDFText_*`) ist darin nicht oder nur unvollständig herausgeführt. Für Text
mit Koordinaten käme deshalb eine zweite Bibliothek dazu — zwei Abhängigkeiten
für eine Aufgabe, jede mit eigenem Aktualisierungsrhythmus.

**Alles über die OCR-Kette** (`pdftoppm`, `pdftotext`, `ocrmypdf`). Funktioniert,
verlangt aber Python, Ghostscript und Poppler auch für Belege, die einen
Textlayer haben — also im Regelfall. Zusätzlich ein Prozessaufruf je Seite.

**pdfjs-dist mit @napi-rs/canvas.** pdfjs liefert Text samt Transformationsmatrix,
Breite und Höhe je Textstück; `@napi-rs/canvas` liefert die Zeichenfläche und
kodiert direkt nach WebP. Beide bringen vorgefertigte Binärdateien mit, unter
Windows ist kein Compiler nötig.

## Entscheidung

**pdfjs-dist für Text und Rendern, @napi-rs/canvas als Zeichenfläche.**

Umgesetzt in [src/ingest/pdf.ts](../../src/ingest/pdf.ts):

- `seitenLesen` liefert je Seite Text, Seitenmaße und die Fundstellen der
  einzelnen Textstücke, umgerechnet auf den Ursprung oben links — PDF zählt
  von unten, die Anzeige von oben
- `hatTextlayer` entscheidet je Dokument, nicht je Seite, ob die OCR-Strecke
  nötig ist; Schwelle sind 40 Zeichen je Seite im Mittel
- `seiteRendern` erzeugt WebP in wählbarer Breite: 240 px für die Trefferliste,
  1240 px für die Leseansicht

## Konsequenzen

Die im Konzept genannte Bibliothek wird nicht verwendet, die Anforderung
dahinter ist erfüllt. Wer §13 liest, findet hier die Begründung.

pdfjs ist in JavaScript geschrieben und langsamer als pdfium in C++. Das trifft
den Import, nicht die Anzeige — gerendert wird einmal beim Eingang, im
Hintergrund, in einer Queue. Bei 25.000 Belegen im Jahr ist der Unterschied
ohne Belang. Sollte der Stapelscan (§24, Punkt 1) das ändern, ist der Wechsel
auf eine Bibliothek beschränkt: die Fachlogik kennt nur `seitenLesen` und
`seiteRendern`.

`ocrmypdf` bleibt unberührt und wird weiterhin für Scans ohne Textlayer
gebraucht — dafür sind Python, Tesseract mit deutschem Sprachpaket und
Ghostscript zu installieren. Diese Entscheidung ersetzt das nicht, sie
begrenzt es auf die Fälle, die es wirklich brauchen.

Eine Umdeutung der Typen bleibt nötig: pdfjs beschreibt den Browser-Kontext,
`@napi-rs/canvas` erfüllt dieselbe Schnittstelle ohne DOM-Typen zu tragen. Die
Stelle ist im Code als solche gekennzeichnet und auf einen Aufruf begrenzt.

Die Fundstellen der Textstücke werden derzeit **nicht** gespeichert.
`dokument_seite` trägt nur den Text. Sobald die Stempelplatzierung sie braucht,
ist zu entscheiden, ob sie als eigene Spalte, als eigene Tabelle oder bei
Bedarf neu berechnet werden — für eine Vorfestlegung ohne Nutzer ist es zu
früh.

## Nachtrag: Schriften beim Rendern

Beim ersten sichtbaren Beleg fiel ein Fehler auf, den kein Test gefunden
hatte: Wörter erschienen auseinandergezogen — „M u s t e r r e i n i g u n g".
Die Textextraktion war korrekt, nur das Bild war falsch.

Ursache: pdfjs zeichnet Text über die Zeichenfläche. Bettet ein PDF seine
Schrift ein, benutzt pdfjs diese Schrift und alles stimmt. Verlässt sich das
PDF auf eine der 14 Standardschriften, sucht die Zeichenfläche eine Schrift
dieses Namens — und nimmt bei Fehlanzeige eine Ersatzschrift mit anderen
Vorschubbreiten.

Nachgeprüft mit zwei erzeugten PDFs, gleicher Text: mit eingebetteter
TrueType-Schrift einwandfrei, mit nicht eingebetteter Helvetica verzerrt. Der
Fehler betrifft also nur die zweite Gruppe. Lieferantenrechnungen betten ihre
Schriften fast immer ein — deshalb wäre das lange unbemerkt geblieben und
irgendwann bei einem schlichten Beleg aufgetaucht.

Behoben in [src/ingest/schriften.ts](../../src/ingest/schriften.ts): metrisch
gleichwertige Schriften werden unter den erwarteten Namen angemeldet — Arial
für Helvetica, Times New Roman für Times, Courier New für Courier, unter Linux
die Liberation-Schriften. Fehlt eine Datei, wird sie übersprungen; das Rendern
soll daran nicht scheitern.

Offen bleibt: Im Container muss ein Schriftpaket installiert sein. Ohne
Liberation-Schriften kehrt der Fehler zurück, und zwar leise.
