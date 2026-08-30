# Handbuch

Für Menschen. Was das System ist, wie man es zum Laufen bringt, wie die
Begriffe zusammenhängen und was bei den üblichen Stolpersteinen zu tun ist.

Die drei anderen Dokumente: [konzept.md](konzept.md) begründet die
Architektur, [stand.md](stand.md) listet maschinell auf, was vorhanden ist,
[adr/](adr/) hält einzelne Entscheidungen fest.

> **Pflege:** Dieses Handbuch wird von Hand geschrieben. `npm run docs:check`
> prüft nur, ob die Befehle noch stimmen — ob ein Absatz noch wahr ist, kann
> kein Skript wissen. Wer etwas ändert, das hier beschrieben ist, ändert es
> hier mit.

---

## Was das System ist

Ein Dokumentenmanagementsystem für die Immobilienverwaltung, als Ersatz für
Amagno. Eine Rechnung kommt herein — per Mail, Scan, Upload oder FTP —, wird
aufbereitet, einem Objekt zugeordnet, geprüft, kontiert, freigegeben, gezahlt
und revisionssicher archiviert. Zusätzlich bekommen Eigentümer, Beiräte und
Mieter befristete, gefilterte Einsicht in die Belege, die sie betreffen.

Zwei Dinge unterscheiden es vom Bestand:

**Der Ablauf ist konfigurierbar, nicht programmiert.** Eine neue Prüfstufe,
ein neuer Stempel, eine neue Ordnungsgruppe, ein neuer Zahlungsweg — alles
Stammdaten. Im Bestand ist jeder Stempel fest mit seinem Ziel verdrahtet; wer
eine Stufe einschiebt, muss dreißig Stempel umhängen.

**Aufbereitet wird beim Eingang, nicht beim Öffnen.** Das ist der Grund,
warum die Anzeige schnell ist: Wenn ein Beleg geöffnet wird, liegt das Bild
längst fertig da.

---

## Einrichtung

Vorausgesetzt sind Node.js (ab Version 22) und Docker Desktop. Die
ausführliche Installationsanleitung samt Windows-Eigenheiten steht in der
[CLAUDE.md](../CLAUDE.md).

```bash
npm install
```

```bash
npm run db:start
```

Der erste Start lädt rund 3 GB Container-Images. Am Ende erscheinen die
Zugänge; wichtig sind zwei: die Datenbank auf Port 54322 und die Weboberfläche
*Studio* auf Port 54323, in der sich Tabellen und Daten ansehen lassen.

```bash
npm run db:reset
```

Baut die Datenbank neu auf: alle Migrationen, danach die Seed-Daten. Das ist
der Befehl nach jedem `git pull`, der eine neue Migration mitbringt.

```bash
npm test
```

Muss grün sein, bevor irgendetwas anderes beurteilt wird. Die Tests sprechen
eine echte Datenbank an, `db:start` muss also laufen.

---

## Tägliche Arbeit

```bash
npm run dev
```

Startet die Anwendung und den Worker nebeneinander. Wer nur an der Pipeline
arbeitet, nimmt `npm run dev:worker`; wer nur an der Oberfläche arbeitet,
`npm run dev:web`.

Eine einzelne Testdatei:

```bash
npm test -- tests/rls.test.ts
```

Ein einzelner Test nach Name:

```bash
npm test -- -t "Mandant"
```

---

## Die Begriffe

Die Fachbegriffe sind durchgängig deutsch und heißen im Code genauso wie im
Gespräch. Wer sie kennt, kann Tabellennamen lesen.

| Begriff | Bedeutung |
|---|---|
| **Mandant** | Verwaltungsunternehmen. Trennt alle Daten voneinander; nichts wird über diese Grenze hinweg sichtbar oder gelernt. |
| **Objekt** | Liegenschaft. Eine WEG, ein Mietobjekt, ein Sondereigentum. Trägt die Zuständigkeit. |
| **Einheit** | Wohnung, Gewerbefläche, Stellplatz innerhalb eines Objekts. |
| **Ordnungsgruppe** | Betriebskosten, Legal, Versicherungsschäden, Technik … Steuert nicht nur die Ablage, sondern auch die Zuständigkeit und den Ablauf. |
| **Spezialgebiet** | Im Bestand „Fachgebiet". Lenkt einen Beleg an einen Spezialisten, ohne ihm das ganze Objekt zu öffnen. |
| **Lauf** | Der Weg eines Belegs durch die Stufen. Kennt seine eingefrorene Prozessfassung. |
| **Stufe** | Eine Station im Lauf: sachliche Prüfung, Kontierung, Freigabe … |
| **Aufgabe** | Was in einem Postfach erscheint. Alle drei Postfächer sind nur Sichten darauf. |
| **Stempel** | Eine getroffene Entscheidung, festgehalten als Ereignis. Sagt *nicht*, wohin der Beleg als Nächstes geht. |
| **Klärung** | Beleg wird geparkt, mit Pflichtkommentar und Wiedervorlagedatum. Die Stempel bleiben gültig. |
| **Kontierung** | Aufteilung des Betrags auf Konten, zeilenweise, mit Umlagefähigkeit je Zeile. |
| **Ampel** | Zwei Werte: wie sicher wurde gelesen (Extraktion), und wie plausibel ist das Ergebnis. Der schlechtere gewinnt. |
| **Kreditor** | Lieferant, Dienstleister, Rechnungssteller. |
| **Vorgang** | Klammer um mehrere Belege: ein Schadensfall, ein Rechtsstreit, ein Mieterwechsel. |

---

## Was das System bewusst nicht tut

Diese Punkte wirken wie fehlende Funktionen und sind Entscheidungen.

**Belege werden nie gelöscht.** Ein abgelehnter Beleg bleibt im Status
`abgelehnt` und wird archiviert. Kommt eine korrigierte Rechnung, ist das ein
*neues* Dokument, mit dem alten verkettet. Beide gehören in die Akte, denn
beide hat es gegeben.

**Ordnungsgruppen werden nie gelöscht, nur deaktiviert.** Sobald Belege daran
hängen, wäre eine Löschung ein Loch in der Historie.

**Ein Stempel lässt sich nicht nachträglich ändern.** Die Stempelhistorie ist
eine Kette, in der jeder Eintrag den vorherigen absichert. Das erfüllt
gleichzeitig die Protokollpflicht nach GoBD.

**Mieter bekommen Belege nicht freigegeben, sie sehen sie gerechnet.** Ein
Mieter sieht einen Beleg genau dann, wenn dieser eine umlagefähige
Kontierungszeile hat und der Leistungszeitraum in seine Mietzeit fällt. Eine
manuelle Freigabe würde bei jedem Mieterwechsel Fehler produzieren.

**Vertretung überträgt keine Rechte.** Wer vertritt, bekommt die *Aufgabe*
über die Eskalation — die Rolle bleibt, wo sie war. Temporär verschobene
Rechte machen jede spätere Prüfung unbeantwortbar.

---

## Häufige Fragen

**Die Tests schlagen alle gleichzeitig fehl. Was ist los?**
Fast immer läuft die Datenbank nicht. `npm run db:start`, dann noch einmal.
Wenn die Fehlermeldung `permission denied to set role "dms_app"` lautet, fehlt
die Migration — `npm run db:reset`.

**Nach `git pull` verhält sich das Schema seltsam.**
`npm run db:reset`. Migrationen werden nicht rückwirkend angewendet.

**Ich habe eine Migration geschrieben, sie wird ignoriert.**
Der Dateiname muss `<zeitstempel>_name.sql` lauten, sonst übergeht die
Supabase CLI ihn stillschweigend. Neue Datei am besten mit
`npm run db:new <name>` anlegen.

**Ein Container startet immer wieder neu.**
Wenn es `supabase_vector` ist: der Log-Sammler, unter Windows bekannt,
unkritisch. Datenbank und Tests sind davon nicht betroffen.

**Warum sehe ich als Bearbeiter ein Objekt nicht?**
Zuständigkeit prüfen — sie ist datiert. Ein abgelaufenes `gueltig_bis` nimmt
die Sicht sofort. Buchhaltung und Geschäftsleitung haben stattdessen globalen
Objektzugriff.

**Ein Update auf `stempel_ereignis` läuft durch, ändert aber nichts.**
Das ist beabsichtigt und doppelt abgesichert: Für die Tabelle gibt es keine
Änderungs-Policy, die Anweisung trifft deshalb null Zeilen. Wer die Rechte
umgeht, bekommt zusätzlich einen Fehler aus dem Trigger.

**Wie kommt ein Beleg ins System?**
Derzeit über `dokumentAufnehmen` im Code — Postfächer, Oberfläche und
Mailimport sind noch nicht gebaut. Der aktuelle Ausbaustand steht in
[stand.md](stand.md).

**Warum ist die Datenbank auf PostgreSQL 17, das Konzept nennt 16?**
Die Supabase CLI legt 17 an. Für das Schema ist das unkritisch. Sobald die
Zielumgebung feststeht, sollte die Entwicklungsumgebung dazu passen — die
Version steht in `supabase/config.toml`.

**Darf ich echte Belege zum Ausprobieren verwenden?**
Nicht im Repository, auch nicht anonymisiert. Zum lokalen Ausprobieren gibt es
`.ablage/` und `lokale-belege/`; beide sind von der Versionierung
ausgenommen. Testdaten werden erzeugt, siehe `tests/hilfe/pdf-bauen.ts`.

---

## Wo was liegt

| Ort | Inhalt |
|---|---|
| `docs/konzept.md` | Das Gesamtkonzept. Die verbindliche Referenz. |
| `docs/handbuch.md` | Dieses Dokument. |
| `docs/stand.md` | Erzeugte Übersicht des Ist-Zustands. |
| `docs/adr/` | Einzelne Architekturentscheidungen mit Begründung. |
| `supabase/migrations/` | Das Schema, als handgeschriebenes DDL. |
| `supabase/seed.sql` | Synthetische Ausgangsdaten. |
| `src/` | Anwendungscode. |
| `tests/` | Tests gegen eine echte Datenbank. |
| `.claude/agents/` | Rollenbeschreibungen für die KI-Agenten. |
