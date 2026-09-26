# Abnahmekriterien

Was das DMS können muss, bevor es Amagno ablöst — und womit es das
nachweist. Jede Zeile nennt den Test, der das Kriterium bei jedem Lauf
prüft. Ein Kriterium ohne Test steht hier nicht: Was sich nicht nachweisen
lässt, ist ein Versprechen, kein Kriterium.

Zwei Nachweisarten (siehe CLAUDE.md, „Zwei Testarten"): **Browsertests**
(`e2e/`) gehen den Weg, den ein Mensch geht; **Regeltests** (`tests/`)
prüfen Regeln gegen die Datenbank, im Rollback. Eine Zusicherung über eine
Policy steht nie in einem Browsertest.

Stand: 24.09.2026, 1.021 Regeltests und 89 Browsertests grün.

## Belege hereinbringen

| Kriterium | Nachweis |
|---|---|
| Ein hochgeladener Beleg wird vom Worker aufbereitet und ist danach im Volltext auffindbar | `e2e/posteingang.spec.ts` |
| Die erkannten Rechnungsfelder stehen mit Wert und Herkunft (Vertrauen, ZUGFeRD, geändert, eingetragen) am Beleg; Pflichtfelder ohne Wert heißen „fehlt“; ein fremdes Haus sieht nichts | `tests/rechnungsdaten.test.ts` |
| Die Belegansicht zeigt den Weg des Belegs als Grafik: Stufen aus der Simulation, Zustände aus den Aufgaben, Stempel mit Name und Zeit; ein fremdes Haus sieht nichts | `tests/belegweg.test.ts` |
| Dieselbe Datei ein zweites Mal ergibt einen roten, verketteten Beleg, keinen Ersatz | `e2e/posteingang.spec.ts` |
| Mehrere Dateien auf einmal werden je ein Beleg; Ablegen per Ziehen | `e2e/posteingang.spec.ts` |
| Ein Stapelscan wird getrennt, korrigiert und erst beim Übernehmen zu Belegen | `e2e/stapel.spec.ts`, `tests/stapel.test.ts` |
| Ein Trennblatt wird am Text und am Barcode erkannt | `tests/stapel.test.ts` |
| Ein überwachter Ordner liefert Belege ohne Klick, mit Objekt vorbelegt | `e2e/eingang.spec.ts` |
| Ein Scan ohne Textlayer ohne eingerichtete Erkennung landet sichtbar im Fehlerkorb | `e2e/fehlerkorb.spec.ts` |
| Mit `DMS_OCR=tesseractjs` bekommt ein Scan ohne Installation eine Textebene an der richtigen Stelle, das Original bleibt unberührt | `tests/ocr-tesseractjs.test.ts` |
| Welche Felder Pflicht sind, legt das Haus fest; nur mit Stammdatenrecht, nur im eigenen Haus; die Ampel rechnet darüber | `tests/pflichtfeld.test.ts` |
| Nachtragen kennzeichnet fehlende Pflichtfelder und stellt die Ampel auf grün, wenn alle da sind; die Erkennung lässt sich erneut anstoßen | `tests/nachtragen.test.ts` |
| Ein unbekannter Rechnungssteller wird mit Name, USt-IdNr. und IBAN vorgeschlagen; übernehmen (nur mit Stammdatenrecht) legt Kreditor und IBAN als „neu“ an und ordnet alle Belege dieses Absenders zu; zuordnen und verwerfen; ein fremdes Haus sieht nichts | `tests/kreditor-vorschlag.test.ts` |
| Die Belegart wird aus dem Inhalt erkannt (Rechnung, Mahnung, Gutschrift, Schriftverkehr); eindeutig Erkanntes wechselt den Ablauf, nur ohne Stempel, nur mit aktivem Ablauf, nie gegen die Wahl eines Menschen | `tests/belegart.test.ts` |
| Ein Beleg ohne erkannte Angaben steht unter „Ohne Zuständigkeit"; nach dem Nachtragen hat die Aufgabe ihren Bearbeiter | `e2e/zuordnung.spec.ts`, `tests/nachtragen.test.ts` |
| Bestandsbelege aus Amagno kommen archiviert mit altem Eingangsdatum an; ein zweiter Lauf ist folgenlos | `tests/uebernahme.test.ts` |

## Belege bearbeiten

| Kriterium | Nachweis |
|---|---|
| Liste, Beleg und Entscheidung stehen nebeneinander; Pfeiltasten wechseln die Aufgabe | `e2e/arbeitsplatz.spec.ts` |
| Der Stempel trägt die Entscheidung, kein Ziel; der Beleg geht von selbst zur nächsten Stufe | `e2e/stempeln.spec.ts`, `tests/engine.test.ts` |
| Klärung verlangt Kommentar und Wiedervorlage; der nächste Stempel beendet sie | `e2e/klaerung.spec.ts`, `tests/postfach.test.ts` |
| Ein harter Befund (fremde IBAN, Dublette) hält jeden Stempel außer Ablehnung und Klärung auf | `tests/postfach.test.ts`, `tests/zahlung.test.ts` |
| Die Kontierung verlangt die volle Summe und sagt, was fehlt; § 35a an der Zeile | `e2e/zahlung.spec.ts`, `tests/kontierung.test.ts` |
| Vor der Zahlung: gültige Freigaben, Pflichtstufen, Summenzwang, Befunde, Zahlungsweg, Bankverbindung — und keine Mahnung | `e2e/zahlung.spec.ts`, `tests/zahlung.test.ts` |
| Eine geänderte Rechnung lässt ihre Freigaben verfallen und springt zurück | `tests/zahlung.test.ts` |
| Vertretung lenkt neue Aufgaben um, ohne Rechte zu übertragen | `e2e/eingang.spec.ts`, `tests/vertretung.test.ts` |
| Eine überfällige Aufgabe wandert nach der hinterlegten Spanne an die hinterlegte Person — einmal | `tests/eskalation.test.ts` |
| Die Systemaktion schreibt beim Erreichen der Stufe ins Ausgangsbuch und rückt selbst weiter | `tests/engine.test.ts` |
| Schriftverkehr ist eine zweite Belegart mit eigener Stufenfolge, kein zweites Modul | `e2e/schriftverkehr.spec.ts` |
| Der Zähler neben „Postfächer" zeigt, was die Liste zeigt; die Sammelmail lässt sich abschalten | `e2e/benachrichtigung.spec.ts` |
| Ein Wartecontainer verlangt eine Wiedervorlage und endet nur mit Ergebnis | `e2e/warten.spec.ts`, `tests/nebenlauf.test.ts` |
| „Wo steht was" zählt je Stufe, und die Zahl passt zur Liste dahinter | `e2e/stufen.spec.ts`, `tests/stufen.test.ts` |

## Belege finden und ansehen

| Kriterium | Nachweis |
|---|---|
| Die erste Seite kommt als Bild, das PDF erst auf Anforderung | `e2e/viewer.spec.ts` |
| Suche mit Treffer links und Beleg rechts; Volltext mit Seite und Auszug | `e2e/belege.spec.ts`, `tests/belegliste.test.ts` |
| Suche im Beleg nennt Seite und Auszug; Notizen liegen neben dem Original | `e2e/belegansicht.spec.ts` |
| Vier Exportvarianten; das Archivoriginal Byte für Byte; Schwärzungen nie im Klartext | `e2e/export.spec.ts`, `tests/export.test.ts` |
| Ein fremder Mandant sieht nichts — in keiner Sicht, auch nicht die Zahl | `tests/belegliste.test.ts` und jede Sicht |

## Nach außen

| Kriterium | Nachweis |
|---|---|
| Ein Mieter sieht seinen Beleg ohne Anmeldung, nach dem Widerruf nicht mehr; ein erfundener Token führt nirgendwohin | `e2e/einsicht.spec.ts` |
| Nichts verlässt das Haus außerhalb des Ausgangsbuchs; ohne Versand bleibt es sichtbar liegen; Vorlagen prüfen ihre Platzhalter vor dem Speichern | `e2e/postausgang.spec.ts`, `e2e/stammdaten.spec.ts`, `tests/postausgang.test.ts` |
| Eine Zahlung wird nie als übergeben vermerkt, wenn die Übergabe scheitert | `tests/zahlung.test.ts` |

## Einrichten und Rechte

| Kriterium | Nachweis |
|---|---|
| Der Ablauf ist eine Liste von Stufen; ein Entwurf wird simuliert, bevor er gilt | `e2e/konfiguration.spec.ts`, `tests/konfiguration.test.ts` |
| Stammdaten pflegen, Benutzer verwalten und Abläufe konfigurieren sind drei Rechte; Lesen bleibt offen | `e2e/stammdaten.spec.ts`, `tests/stammdaten.test.ts` |
| Presets ergänzen, nie überschreiben | `e2e/presets.spec.ts`, `tests/presets.test.ts` |
| Der Notfallzugriff steht über jeder Seite, befristet, ohne Rechteänderung | `e2e/notfall.spec.ts`, `tests/notfall.test.ts` |
| Die Anmeldung bestätigt nur, wer jemand ist; eine Sitzung ist sofort widerrufbar | `tests/anmeldung.test.ts` |
| Keine Seite hat schwere Barrierefreiheitsbefunde — hell und dunkel | `e2e/barrierefreiheit.spec.ts` |

## Aufbewahren und löschen

| Kriterium | Nachweis |
|---|---|
| Nach der Archivierung ist der Beleg fest; nur Storno und Neuerfassung | `tests/archiv.test.ts` |
| Die Stempelkette ist nachträglich nicht änderbar und hängt nicht an der Serverzeitzone | `tests/archiv.test.ts`, `tests/sicherung.test.ts` |
| Object Lock hält die Fassung, jede Lesestelle liest die Fassung mit | `tests/objektsperre.test.ts` (braucht MinIO, meldet sonst) |
| Löschen erst nach Fristablauf, je Beleg, mit Protokoll ohne Personenbezug; Einschränkung statt Löschung bei Aufbewahrungspflicht | `e2e/loeschen.spec.ts`, `tests/loeschen.test.ts` |
| Die Sicherung wird geprobt, und die Probe vermerkt sich selbst | `tests/sicherung.test.ts`, `npm run sicherung:pruefen` |
| Die Verfahrensdokumentation wird aus dem Repository erzeugt; ein veralteter Stand wird nicht freigegeben | `npm run docs:check`, `tests/verfahrensdoku.test.ts` |

## Betrieb

| Kriterium | Nachweis |
|---|---|
| Produktionsbuild und Container bauen; der Worker meldet sich im Minutentakt | `npm run build`, `docker build`, `tests/betrieb.test.ts` |
| Die Inbetriebnahme misst am echten Eimer, ob die Sperre greift | `npm run inbetriebnahme` (auf dem Server) |
| Die Objektakte lässt sich für den Verwalterwechsel exportieren | `tests/archiv.test.ts`, `npm run objektakte` |

## Was die Tests nicht beweisen können

- Dass die Anmeldung gegen **das** Entra ID des Hauses funktioniert, samt Abmeldung — das geht erst mit der App-Registrierung.
- Dass der IMAP-Abruf gegen den echten Mailserver läuft.
- Dass der Amagno-Export des Hauses zur `uebernahme.json` passt — die Probe sagt es, bevor etwas geschrieben wird.
- Dass Menschen mit dem System arbeiten wollen. Dafür gibt es den Parallelbetrieb.
