# 0003 · Erkennung: strukturierte Rechnung zuerst, Modell nur auf Ansage

Stand: 31. August 2026 · angenommen

## Kontext

Konzept §13 sieht die Extraktion hinter einem Provider-Interface vor, mit
Bedrock in Frankfurt als Standard und einem lokalen Modell als Ausweichweg.
Beim Umsetzen stellte sich heraus: Es gibt **kein AWS-Konto**. Damit ist
Bedrock derzeit keine Option, und die Frage lautet, was ohne Modell möglich
ist.

## Entscheidung

**Drei Wege, in fester Reihenfolge.**

**1 · Strukturierte Rechnung (ZUGFeRD, XRechnung).** Diese Belege tragen ihre
Daten als XML mit — eingebettet im PDF oder als reine XML-Datei. Es gibt
nichts zu raten; das Extraktionsvertrauen ist per Definition 1,0 (§14). Kein
Modell, keine laufenden Kosten, kein Datenabfluss. Der Anteil solcher
Rechnungen wächst, seit die E-Rechnung im B2B-Bereich verpflichtend ist.

**2 · Lokales Modell (Ollama).** Läuft auf eigener Hardware. Wird nur benutzt,
wenn `DMS_EXTRAKTION=ollama` gesetzt ist.

**3 · Keiner.** Die Voreinstellung. Ohne ausdrückliche Einstellung wird nicht
geraten; der Beleg läuft weiter und wird von Hand erfasst. Das ist die
ehrlichere Vorgabe als ein Modell, das niemand bestellt hat — und es
entspricht §13: Fällt der Anbieter aus, startet der Workflow trotzdem.

Bedrock anzuschließen ist eine weitere Datei neben `ollama.ts` und sonst
nichts. Die Fachlogik kennt nur `Extraktionsanbieter`.

## Konsequenzen

**Der Text genügt.** Die Aufbereitung liest den Seitentext bereits mit
Koordinaten. Das Modell bekommt Text, keine Bilder — ein mittelgroßes
Textmodell auf einer einzelnen Grafikkarte reicht, es braucht kein Modell,
das Seiten sehen kann. Das senkt die Anforderungen an Weg 2 erheblich.

**Ein Modell bekommt nie die volle Sicherheit.** `antwortLesen` deckelt die
Confidence bei 0,95. Die Eins ist strukturierten Rechnungen vorbehalten,
sonst wäre die Ampel nicht mehr zu lesen.

**Ein fehlendes Feld ist besser als ein geratenes.** Der Prompt sagt das
ausdrücklich, und die Auswertung überspringt Werte im falschen Format, statt
sie zurechtzubiegen. Was fehlt, geht in die manuelle Erfassung — nicht in eine
stille Fehlbuchung.

**Bestätigte Werte werden nicht überschrieben.** Die Übernahme in
`rechnung_fakten` setzt nur, was leer ist.

**Was noch fehlt:** die Plausibilitätsprüfungen und damit `ampel_gesamt`
(§14) — darunter die beiden harten Rot-Fälle IBAN und Dublette. Gesetzt wird
bisher nur `ampel_extraktion`. Ebenso der Lernspeicher (§15); die
Kreditorzuordnung läuft vorerst deterministisch über USt-ID und Name.

## Beim Bauen aufgefallen

`istStrukturierteRechnung` suchte im PDF nach der Zeichenkette
`factur-x.xml`. Das ist unzuverlässig: Ein PDF legt Dateinamen komprimiert
ab, die Zeichenkette steht dort nicht im Klartext. Eine echte
ZUGFeRD-Rechnung galt damit als gewöhnliches PDF. Aufgefallen ist es erst,
als der erste echte Beleg mit eingebettetem XML durch den Test lief. Die
Funktion ist entfallen; der Weg ergibt sich jetzt aus dem Ergebnis der
Erkennung.
