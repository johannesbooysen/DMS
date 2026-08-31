# Messungen

„Vor jeder Performance-Optimierung messen, danach erneut." Das Konzept macht
es in §21 vor; hier stehen die Messungen der Umsetzung.

Jeder Eintrag nennt, **was** gemessen wurde, **womit** und **unter welchen
Bedingungen** — eine Zahl ohne diese drei Angaben ist keine Messung, sondern
eine Behauptung.

---

## Viewer: erste Seite

**Anforderung:** §23 verlangt die erste Seite unter 100 ms, das PDF nur per
Range-Request.

**Aufbau:** Produktionsbuild (`npm run build`, `npm start`), Next.js 16.3.3
auf Node 24, lokale Supabase-Instanz auf demselben Rechner (Windows 11,
Docker Desktop). Beleg mit vier Seiten, erzeugt über
`scripts/beispielbeleg.ts`. 20 Aufrufe je Pfad nach zwei Aufwärmaufrufen,
gemessen mit `Invoke-WebRequest` einschließlich Verbindungsaufbau.

**Gemessen am 30. August 2026:**

| Pfad | Median | Min | Max | Größe |
|---|---|---|---|---|
| Seite 1, Leseansicht (WebP, 1240 px) | **28,9 ms** | 26,1 ms | 54,0 ms | 23.708 B |
| Seite 1, Miniatur (WebP, 240 px) | **25,6 ms** | 23,8 ms | 60,0 ms | 2.386 B |
| Belegseite (HTML, serverseitig gerendert) | **44,3 ms** | 39,3 ms | 52,7 ms | — |

Die Anforderung ist mit deutlichem Abstand erfüllt. Die Belegseite enthält
zwei Datenbankabfragen unter RLS; das Bild selbst ist ein Nachschlagen des
Ablageschlüssels plus Dateiauslieferung.

**Was die Zahl nicht sagt:** Gemessen wurde auf einem Entwicklungsrechner mit
lokaler Ablage im Dateisystem. Mit S3 kommt Netzwerklatenz dazu — der
Ablageschlüssel liegt dann aber immer noch nach einer Indexabfrage vor, und
das Bild wird unverändert durchgereicht. Der Anteil, den wir selbst
verantworten, ändert sich dadurch nicht.

**Range-Request** (dieselbe Umgebung): `bytes=0-1023` liefert 206 mit
`content-range: bytes 0-1023/2110`, die Suffix-Form `bytes=-512` liefert die
letzten 512 Bytes. Ohne Range-Kopf kommt die vollständige Datei mit
`accept-ranges: bytes`.

---

## Erkennung: lokales Modell auf dem Prozessor

**Anforderung:** Keine. Das Konzept gibt für die Extraktion keine Zeit vor —
sie läuft asynchron in der Warteschlange, niemand wartet davor. Die Messung
beantwortet eine andere Frage: Ist die Trefferquote gut genug, und ist die
Dauer im Hintergrund tragbar?

**Aufbau:** `scripts/extraktion-messen.ts`, zwei erfundene Rechnungen mit
bekannter Wahrheit, je drei Durchläufe. Ollama 0.33.2, Modell
`qwen2.5:7b-instruct` (4,36 GB, 7,6 Mrd. Parameter). AMD Ryzen 7 PRO 6850H,
8 Kerne, 31 GB RAM — **auf dem Prozessor gerechnet**, ohne Grafikkarte: Die
verbaute Radeon RX 6500M wird von Ollama nicht unterstützt und hätte mit 4 GB
ohnehin nicht gereicht.

Der zweite Beleg ist absichtlich unbequemer gesetzt: „Beleg-Nr." statt
„Rechnung Nr.", Datum im Fließtext, Beträge ohne Währungsangabe in der Zeile.

**Gemessen am 31. August 2026:**

| | Wert |
|---|---|
| Trefferquote | **30 von 30 Feldern** |
| Ohne Antwort | 0 von 6 Läufen |
| Streuung | alle Läufe identisch |
| Dauer Median | **51,2 s** |
| Dauer min/max | 36,5 s / 64,7 s |

Bei rund 100 Belegen am Werktag ergibt das etwa anderthalb Stunden Rechenzeit
im Hintergrund. Das ist tragbar, solange die Warteschlange nicht auch andere
Arbeit tut.

**Was die erste Messung wert war.** Sie lief vor dieser und ergab 21 von 30.
Falsch waren nur die Beträge: 10234 statt 1023,40. Die Ursache lag nicht im
Modell, sondern im Auswerter — er entfernte alle Punkte als deutsche
Tausendertrennzeichen, während der Prompt um den Punkt als
Dezimaltrennzeichen bittet. Deterministisch, in jedem Lauf gleich, **bei
grüner Ampel**: Das Modell war sich seiner Sache zu Recht sicher, falsch war
die Umwandlung danach.

Ohne den Vergleich gegen die bekannte Wahrheit wäre das durchgerutscht. Ein
Beleg über 1.023,40 € wäre mit 102.340 € in die Freigabe gegangen. Behoben in
`src/extraktion/zahlen.ts`, abgesichert durch sechs Tests.


### Vergleich der Modellgrößen

Dieselben Belege, dieselbe Wahrheit, nur das Modell getauscht:

| Modell | Größe | Trefferquote | Dauer Median |
|---|---|---|---|
| `qwen2.5:7b-instruct` | 4,36 GB | **30 / 30** | 51,2 s |
| `qwen2.5:3b-instruct` | 1,93 GB | **0 / 30** | 13,9 s |

Die kleine Fassung ist viermal schneller und unbrauchbar. Bemerkenswert ist
**wie** sie scheitert: Sie hält das geforderte Schema exakt ein und liefert
`{"wert": …, "confidence": …}` — schreibt in `wert` aber Zahlen wie `0,8`,
`0,19` und `0,95`, die wie Vertrauenswerte aussehen. Kein Parserfehler,
sondern Überforderung. Das 7B-Modell liefert an denselben Stellen
`"Elektro Blitz e.K."`, `381,70` und `454,22`.

**Empfehlung: 7B.** Die Dauer ist im Hintergrund tragbar, eine Trefferquote
von null ist es nicht.

**Was dieser Fehlschlag über die nächste Baustelle sagt:** Die 3B-Antwort
behauptete netto 0,80, Steuer 0,19 und brutto 0,95 — bei einem Beleg über
454,22 €. Die Plausibilitätsprüfung aus §14 hätte das in einer Zeile
erledigt, denn netto + Steuer ≠ brutto. Genau dafür sieht das Konzept zwei
getrennte Vertrauenswerte vor: Das Extraktionsvertrauen war hoch, die
Plausibilität wäre es nicht gewesen. Solange nur `ampel_extraktion` gesetzt
wird, fehlt dem System dieser zweite Blick.


**Was die Zahl nicht sagt:** Zwei Belege sind keine Stichprobe. Sie zeigen,
dass die Strecke funktioniert — nicht, wie das Modell mit einer Rechnung
umgeht, die niemand vorhergesehen hat. Belastbar wird das erst an echten
Belegen, und die dürfen für eine Messung dieser Art das Haus nicht verlassen;
mit dem lokalen Modell tun sie das auch nicht.


---

## Aus dem Konzept übernommen

Die Messungen aus §21 stammen aus der Konzeptionsphase, gegen 1.000.000
synthetische Dokumente. Sie sind die Begründung für mehrere
Designentscheidungen und stehen als Kommentare in den Migrationen:

| Abfrage | 1.000.000 Belege |
|---|---|
| Postfach: offene Aufgaben eines Benutzers | 2,2 ms |
| Akte eines Objekts | 0,7 ms |
| Objektübergreifender Feed, Top-N je Objekt | 13,1 ms |
| Derselbe Feed naiv | 63,5 ms |
| RLS über Unterabfrage statt `meine_objekte()` | 264,0 ms |
| Mietersicht ohne `hat_umlagefaehige_zeile` | 48,6 ms |
| Mietersicht mit Flag | 11,9 ms |

Diese Werte sind **nicht** gegen die jetzige Umsetzung nachgemessen. Sobald
genügend Daten vorliegen, gehört das nachgeholt — die Schemaentscheidungen
hängen daran.
