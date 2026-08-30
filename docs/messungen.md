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
