# ADR 0007 — Ein Server, ein Image, zwei Prozesse

**Status:** angenommen (2026-09-07)
**Betrifft:** `Dockerfile`, `compose.yaml`, `Caddyfile`, `.env.beispiel`,
`next.config.ts`, `src/betrieb/`, `src/app/api/lebenszeichen/`,
`scripts/lebenszeichen-pruefen.ts`,
`supabase/migrations/20260907140000_lebenszeichen.sql`

## Ausgangslage

Bis hierher gab es keine Betriebsumgebung: kein Dockerfile, keine CI, kein
beschriebenes Ziel. Die Anwendung ist web-basiert und mandantenfähig; die
Zielgröße sind 500 Objekte und rund 25.000 Belege im Jahr, also etwa hundert
am Werktag.

Drei Eigenschaften des Systems schneiden die Auswahl stärker als jeder
Anbietervergleich:

1. **Zwei Prozesse.** `next start` und ein langlaufender Worker. Am Worker
   hängen nicht nur die Warteschlangen, sondern die Objektsperre, das
   Abräumen gelöschter Dateien und die tägliche Sammelmail.
2. **Native und externe Programme.** `@napi-rs/canvas` (glibc), `pdfjs-dist`,
   dazu `ocrmypdf` als gespawntes Fremdprogramm.
3. **Postgres als Sicherheitsgrenze.** Eigene Rolle `dms_app`,
   `set local role`, `security definer`, festgenagelte `timezone`/`datestyle`,
   `pg_dump`-Sicherung mit Manifest.

## Entscheidung

**Ein deutscher Server, `docker compose`, vier Container:** Datenbank, Web,
Worker, Reverse Proxy. Web und Worker teilen sich **ein** Image und
unterscheiden sich nur im Startbefehl. Der Objektspeicher liegt beim
Anbieter — S3-kompatibel mit Object Lock im Compliance-Modus, **am selben
Standort wie der Server**.

Die Systembetreuung übernimmt der Betreiber selbst; das ist die Bedingung,
unter der diese Entscheidung richtig ist (siehe *Wann das falsch wird*).

### Warum kein Serverless

Der Worker hat keine Adresse und keinen Anlass von außen — er läuft. Kein
Zeitlimit einer Funktionsplattform passt zu OCR, und `ocrmypdf` bekommt man
dort nicht hinein. Web dort und Worker anderswo zu betreiben hieße: zwei
Betriebsumgebungen für ein System und zwei Orte für dieselbe Konfiguration.

### Warum ein Image für beide

Zwei Images wären zwei Stände, die auseinanderlaufen — und der Fehler fällt
genau dann auf, wenn der Worker eine Tabelle nicht kennt, die die Anwendung
schon schreibt.

### Warum Debian und nicht Alpine

`@napi-rs/canvas` liefert vorgebaute Binärdateien gegen glibc. Auf musl gäbe
es entweder keinen Treffer oder eine Rust-Werkzeugkette im Image. Das
PDF-Rendern ist kein Randfall, sondern der Kern des
Geschwindigkeitsversprechens.

### Warum `tsx` in Produktion

`tsx` wandert von den Dev- in die Laufzeitabhängigkeiten: Der Worker führt
TypeScript direkt aus. Der Grund ist nicht Bequemlichkeit — **`@/`-Aliase
stehen in neunzehn Modulen unter `src/`, und `tsc` löst sie beim Emit nicht
auf.** Ein kompilierter Worker bräuchte einen Bündler, also einen zweiten
Bauweg mit eigenen Fehlerbildern, der abweicht, wenn niemand hinsieht. So
läuft in Produktion derselbe Quelltext, den die Tests fahren.

### Warum der Objektspeicher an denselben Standort gehört

**Jedes Seitenbild geht durch den Node-Prozess** — Sitzung auflösen,
Berechtigung je Seite prüfen, Datei ausliefern. Eine signierte Direkt-URL
wäre ein Link, der die Sitzung überlebt und an der RLS vorbeiführt; deshalb
bleibt es dabei. Damit ist die Latenz zum Objektspeicher unser Problem und
nicht das des Anbieters. Gemessen wurden 28,9 ms für die erste Seite gegen
lokale Platte (`docs/messungen.md`); über das offene Netz zu einem anderen
Anbieter kommen je Bild zehn bis dreißig Millisekunden dazu, und eine Liste
mit zwanzig Miniaturen multipliziert das.

Gedämpft wird es durch `cache-control: private, max-age=31536000, immutable`:
Ein Seitenbild holt ein Browser **einmal**. Die Latenz kostet beim ersten
Ansehen, nicht beim Blättern. Ein CDN hilft hier nie — `private` ist richtig,
weil die Prüfung benutzerbezogen ist.

### Warum die Datenbank mehr Maschine braucht, als die Belegzahl vermuten lässt

Mandantenfähigkeit heißt hier: **eine** Datenbank, RLS als Grenze. Das ist
auch die schnellere Auslegung — der teuerste Fund des Projekts war ein
Mandantenfilter (92 s → 140 ms durch die InitPlan-Form). Es heißt aber auch,
dass Volltext (GIN) und der objektübergreifende Feed (LATERAL) alle Mandanten
auf denselben Kernen bedienen. Deshalb **dedizierte vCPU statt geteilter**:
Steal Time ist es, was aus 160 ms unvorhersehbare 400 macht.

Aus demselben Grund bekommt der Worker in `compose.yaml` feste CPU- und
Speichergrenzen. OCR und PDF-Rendern sind die einzigen Arbeiten, die einen
Kern lange belegen; ohne Grenze bremst der Stapelscan eines Mandanten die
Suche aller anderen. Bei einer gemeinsamen Datenbank ist das kein
Fremdverschulden mehr, sondern unsere Auslegung.

### Keine Migration beim Start

Migrationen laufen **von Hand** über die Supabase-CLI durch einen SSH-Tunnel,
nicht selbsttätig beim Hochfahren eines Containers. Zwei Gründe: Zwei
startende Container würden dieselbe Migration nebenläufig anwenden, und eine
fehlerhafte Migration liefe nachts um drei ohne jemanden, der zusieht. Der
Weg bleibt damit derselbe wie in der Entwicklung — kein zweiter
Migrationsläufer mit eigenen Fehlern.

## Was die Prüfung ergab

Zwei Befunde, beide gemessen und nicht angenommen:

**Der Bau braucht keine Datenbank.** Nachgeprüft mit einer unerreichbaren
`DATABASE_URL`: `npm run build` läuft durch, jede Datenseite ist dynamisch.
Ohne diese Prüfung wäre der Bau im Image an einer Stelle gescheitert, an der
niemand eine Datenbank vermutet.

**Der Upload war auf 1 MB begrenzt.** Er läuft über eine Server Action, und
`serverActions.bodySizeLimit` war nicht gesetzt — die Vorgabe von Next ist
1 MB. Das fällt in der Entwicklung nicht auf, weil Seed-Belege und E2E-PDFs
Kilobytes groß sind; der erste eingescannte Beleg wäre an einer Grenze
gescheitert, die niemand gesetzt hat. Jetzt 64 MB, und die Grenze im
`Caddyfile` liegt mit 80 MB **absichtlich darüber**: So lehnt die Anwendung
ab, die weiß, worum es ging, und nicht der Proxy mit einem nackten 413.

## Das Lebenszeichen

Ein Gesundheitsendpunkt, der prüft, ob die Anwendung antwortet, beantwortet
eine Frage, die er selbst schon beantwortet hat. Interessant ist der
**andere** Prozess: Stirbt der Worker, hört das System still auf zu sperren,
zu löschen und zu benachrichtigen — und die Oberfläche sieht dabei völlig
normal aus. Auffallen würde es im Prüfungsfall.

Deshalb `betrieb_lebenszeichen`, vom Worker im Minutentakt geschrieben, und
drei Blickwinkel auf dieselbe Tabelle:

| Frage | Weg | Für wen |
|---|---|---|
| Läuft das System? | `/api/lebenszeichen` | Überwachung, Mensch |
| Soll *dieser* Container neu starten? | `/api/lebenszeichen?dienste=` | Web-Container |
| Läuft der Worker noch? | `npm run betrieb:pruefen` | Worker-Container |

Ohne diese Trennung hinge die Gesundheit des Webcontainers am Worker: Docker
startete bei totem Worker die Anwendung neu — den einen Prozess, der nichts
dafür kann.

**Nichts vorgefunden ist nicht nichts.** Ein Dienst, der nie eingetragen hat,
fehlt in der Tabelle; ein Befund, der die Liste nur durchsieht, fände dann
nichts zu beanstanden. `verstummt` führt deshalb die *erwarteten* Dienste
gegen die vorgefundenen — dieselbe Regel wie bei `sicherung:pruefen`.

Die Tabelle hat **bewusst keinen Mandantenbezug**: Sie sagt, dass ein
Betriebssystemprozess läuft, und den gibt es nicht je Mandant. Geschrieben
wird nur über eine `security definer`-Funktion; es gibt keine Schreibpolicy
und kein `insert`-Recht, weil ein zweiter Weg, ein Lebenszeichen zu setzen,
ein Weg wäre, eines vorzutäuschen.

## Folgen

- Ein Rechner ist ein Ausfallpunkt. Vertretbar bei dieser Größenordnung,
  **weil die Wiederherstellung geprobt ist** (`sicherung:pruefen`) — nicht,
  weil ein Ausfall unwahrscheinlich wäre.
- Die Systembetreuung ist eine benannte Person mit laufender Pflicht:
  Updates, Zertifikate, Sicherungen, das Ansehen der Löschliste.
- Der Objektspeicher-Anbieter ist noch offen. **Object Lock im
  Compliance-Modus ist die Bedingung**, und sie wird gemessen, nicht
  geglaubt: `tests/ablage-s3.test.ts` und `tests/objektsperre.test.ts` laufen
  gegen einen echten Endpunkt.

## Wann das falsch wird

Wenn die Systembetreuung faktisch niemand mehr übernimmt. Ein ungepatchter
Server nach einem Jahr ist das größere Risiko als jede Anbieterbindung; dann
gehören Datenbank und Laufzeit zu einem Anbieter mit Wartungspflicht, auch
gegen Aufpreis und Kontrollverlust.

Ebenso, wenn Mandanten mit sehr unterschiedlichem Volumen dazukommen: Die
gemeinsame Datenbank ist die schnellere Auslegung, aber ab einem Punkt ist
die Rückwirkung zwischen Mandanten kein Auslegungsdetail mehr. Der Auslöser
ist eine Messung, keine Vermutung — Suchlaufzeit und Feed unter
gleichzeitiger Last.
