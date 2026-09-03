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

## Belegliste gegen eine Million Belege

**Anforderung:** §21 nennt für den objektübergreifenden Feed 13,1 ms und für
die Akte eines Objekts 0,7 ms — und leitet daraus drei Designentscheidungen
ab. Diese Entscheidungen stehen jetzt im Code, also mussten sie nachgemessen
werden.

**Aufbau:** `npx tsx scripts/belegliste-messen.ts 1000000`. 1.000.000
Dokumente auf 500 Objekten, der Messbenutzer ist für 50 davon zuständig —
dieselbe Verteilung wie im Konzept. 100.000 Belege mit Seitentext. Lokale
Supabase-Instanz (PostgreSQL 17) auf Windows 11 unter Docker Desktop,
denselben Rechner wie die Anwendung. Sieben Läufe nach zwei Aufwärmläufen,
gemessen als dms_app mit gesetztem `app.benutzer_id`.

**Gemessen am 31. August 2026, nach der Policy-Umstellung:**

| Abfrage | Median | Min | Max |
|---|---|---|---|
| Feed naiv (`= any(app.meine_objekte())` im WHERE) | 73.840,2 ms | 73.191,0 ms | 120.458,1 ms |
| **Feed Top-N je Objekt (LATERAL)** | **159,6 ms** | 144,9 ms | 204,1 ms |
| Akte eines Objekts | **8,7 ms** | 7,4 ms | 9,8 ms |
| Gefilterte Liste (Ampel rot) | **35,6 ms** | 32,3 ms | 36,9 ms |
| Zählung derselben Liste | 31,5 ms | 30,8 ms | 35,3 ms |
| Volltext (ein Wort) | 403,7 ms | 331,4 ms | 501,0 ms |

### Was die Messung gefunden hat

**`stable` heißt nicht „einmal ausgewertet".** Das ist der eigentliche Fund,
und er stand so nicht im Konzept.

§21 warnt vor der falschen RLS-Strategie und schreibt vor, die
Objektsichtbarkeit über eine `stable security definer`-Funktion aufzulösen
statt über eine Unterabfrage je Zeile. Genau das stand auch im Schema. Der
Feed brauchte trotzdem **92 Sekunden**.

Der Ausführungsplan zeigte, warum:

```
Filter: (... AND (objekt_id = ANY (app.meine_objekte())) ...)
```

`stable` sichert nur zu, dass die Funktion innerhalb eines Statements
dasselbe liefert. PostgreSQL *darf* das Ergebnis wiederverwenden — im
Zeilenfilter einer Policy tut es das nicht. `app.meine_objekte()` braucht
allein 10 ms; bei 100.000 gefilterten Zeilen sind das über tausend Sekunden
Funktionsaufrufe für eine Trefferliste.

Die Abhilfe ist eine Klammer: Als unkorrelierte Unterabfrage
`(select app.meine_objekte())` wird daraus ein InitPlan, einmal je Statement
berechnet. Der Cast `::uuid[]` gehört dazu — ohne ihn liest der Parser die
Mengenform `ANY (subquery)` und der Index fällt weg.

| Zustand | Feed (LATERAL) |
|---|---|
| Policy mit direktem Funktionsaufruf | 92.154 ms |
| Policy mit InitPlan-Form | **140 ms** |

Betroffen waren **49 von 65 Policies**. Alle wurden umgestellt
([Migration 20260831210000](../supabase/migrations/20260831210000_policies_initplan.sql)).

**LATERAL ist nicht nur schneller — es ist die Form ohne den Fehler.** Die
naive Variante bleibt auch nach der Policy-Umstellung bei 74 Sekunden, weil
sie `app.meine_objekte()` selbst im WHERE aufruft. Im LATERAL steht die
Funktion im FROM und wird einmal ausgewertet. Das ist eine schärfere
Begründung als „materialisiert erst alle Treffer".

### Wie die Zahlen zum Konzept stehen

Durchweg langsamer als §21 — Faktor 12 beim Feed, Faktor 12 bei der Akte.
Zwei Gründe, beide bekannt und keiner beunruhigend:

* Gemessen wurde auf einem Entwicklungsrechner mit Datenbank in Docker unter
  Windows, nicht auf Serverhardware.
* Die Policy ist seither gewachsen: Sie prüft zusätzlich `eingeschraenkt`
  (Archivierung) und das Spezialgebiet. Das sind zwei Zweige mehr in einer
  ODER-Verknüpfung, und die kostet auch als InitPlan.

Für die Zielgröße — 500 Objekte, 25.000 Belege im Jahr — ist das Vierzigfache
des Jahresvolumens mit 160 ms für den Feed und 9 ms für die Akte deutlich
schnell genug.

**Was die Zahlen nicht sagen:** Der Volltext liegt mit 404 ms an der Grenze
des Angenehmen. Gemessen wurde ein Wort, das in **allen** 100.000 Belegen mit
Text vorkommt — der ungünstigste Fall. Ein selektiver Begriff ist deutlich
schneller. Bevor hier optimiert wird, gehört gemessen, wie echte Suchbegriffe
sich verteilen.

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

Der Feed und die Akte sind inzwischen nachgemessen (siehe oben) — mit einem
Fund, der im Konzept fehlte. Offen bleiben Postfach und Mietersicht unter
Last; beide hängen an denselben Policies und sollten nach derselben Methode
geprüft werden.

---

## Auswertungen gegen 250.000 Stempelereignisse

**Anforderung:** §24.11 nennt Durchlaufzeiten je Stufe, verlorene Skonti und
die ältesten offenen Belege. Alle drei sind Aggregate — genau die Abfragen,
die mit Seed-Daten schnell aussehen und im Betrieb stehenbleiben.

**Aufbau:** Lokale Supabase-Instanz (PostgreSQL 17, Docker Desktop,
Windows 11). Synthetisch erzeugt: 50.000 Belege über 400 Tage verteilt,
50.000 Läufe, **250.000 Stempelereignisse** (fünf Stufen je Lauf), bei rund
40 % der Belege eine Skontovereinbarung mit abgelaufener Frist. Drei Läufe je
Abfrage nach einem Aufwärmlauf, gemessen von der Anwendungsseite aus
einschließlich Verbindung.

**Gemessen am 2. September 2026:**

| Abfrage | Zeit | Zeilen |
|---|---|---|
| `app.durchlaufzeiten()` — Vorgabe 90 Tage | **185–234 ms** | 5 |
| `app.durchlaufzeiten(null, null)` — gesamte Geschichte | 662–776 ms | 5 |
| `app.skonto_summe()` | **49 ms** | 1 |
| `app.skonto_verluste()` — 50 größte | **46 ms** | 50 |
| `app.aelteste_offene()` | **41 ms** | 25 |

### Was die Messung entschieden hat

**Der Vorgabezeitraum ist 90 Tage, nicht „alles".** Der unbegrenzte Lauf ist
dreimal so teuer und geht auf die Platte (`temp read=7640 written=3800` — der
Sortierlauf der Fensterfunktion passt nicht in `work_mem`). Von einer
Weboberfläche aus entstünde diese Abfrage aus einem leeren Eingabefeld, also
gerade dann, wenn niemand sie gewollt hat. Deshalb kann `src/auswertung`
sie gar nicht stellen: `null` fällt dort ebenfalls auf 90 Tage zurück. In SQL
bleibt sie erreichbar — dort hat man sie entschieden statt vergessen.

**Ein Index auf `stempel_ereignis (zeitpunkt)` wurde geprüft und verworfen.**

| | ohne Index | mit Index |
|---|---|---|
| 90 Tage | 199 ms | 187 ms |
| gesamte Geschichte | 665 ms | **742 ms** |

Der Gewinn im Vorgabefall liegt im Rauschen, der unbegrenzte Fall wird
schlechter. Derselbe Befund wie beim Index auf `eingang_am` in §21 — ein
zusätzlicher Index kann schaden. Die teure Stelle ist nicht das Finden der
Zeilen, sondern die Fensterfunktion: `lag()` braucht den Vorgänger jedes
Ereignisses, gleich welcher Entscheidung, und muss deshalb über alle
Ereignisse des Zeitraums sortieren.

**Die Skonto-Auswertung wurde geteilt.** Über ein Jahr lieferte sie 7.918
Zeilen in 86 ms. Das ist schnell und trotzdem falsch: Wer 7.918 Zeilen an
eine Seite gibt, hat keine Auswertung gebaut, sondern einen Datenauszug — die
Frage „was hat uns das gekostet" beantwortet er nicht. Seitdem liefert
`app.skonto_summe` die Zahl (49 ms) und `app.skonto_verluste` die 50 größten
Einzelfälle (46 ms), beide aus derselben Definition.
