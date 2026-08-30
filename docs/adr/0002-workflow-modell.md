# 0002 · Workflow-Modell: Kette oder Graph, Bedingungen, Delegation

Stand: 30. August 2026 · vorgeschlagen

> Dieses ADR ist noch nicht angenommen. Es beschreibt drei zusammenhängende
> Entscheidungen, die **vor** dem Bau der Workflow-Engine fallen sollten,
> weil sie danach das Zehnfache kosten. Eine davon weicht ausdrücklich vom
> Konzept ab.

## Kontext

Die Anforderung lautet: Der Ablauf soll vollständig dynamisch sein — änderbar,
ergänzbar, anpassbar —, und er soll in einem optischen Baukasten per
Ziehen und Verbinden gepflegt werden, vergleichbar mit den Editoren von
puzzleapp.io. Zusätzlich soll sich der Ablauf für eine Rolle oder einen
einzelnen Mitarbeiter ganz oder teilweise auf andere übertragen lassen.

Dem stehen drei Festlegungen gegenüber.

**Das Konzept lehnt einen Prozessdesigner ab.** §8.8 beginnt mit dem Satz
„Kein Prozessdesigner" und begründet das: Vier Bausteine — Reihenfolge,
Zuständigkeit, Bedingung, erlaubte Stempel — genügen für den gesamten
beschriebenen Ablauf, und eine sortierbare Liste ist für Sachbearbeiter
bedienbarer als eine Zeichenfläche.

**Das gebaute Modell ist eine Kette, kein Graph.** `prozessstufe` trägt
`reihenfolge` und `parallelgruppe`; gleiche Gruppennummer heißt „gleichzeitig,
Reihenfolge egal, alle müssen abschließen". Eine Tabelle für Übergänge gibt
es nicht. Bedingungen gibt es nur als `betrag_von` / `betrag_bis`.

**Rechte werden nicht übertragen.** Entscheidung 8 im Konzept: Vertretung
läuft über die Eskalation, die Aufgabe wandert, die Rolle bleibt. Begründung:
Ein Rechtemodell, das sich temporär verschiebt, ist im Prüfungsfall nicht mehr
beantwortbar — wer im März freigeben durfte, muss im November feststellbar
sein.

Nicht gebaut ist außerdem das Rollenmodell aus §17 (`rolle`, `rolle_recht`,
`benutzer_rolle_objekt`); an seiner Stelle steht der Platzhalter
`benutzer.globaler_objektzugriff`.

---

## Teil A · Ablaufmodell

### Optionen

**A1 — Kette behalten, Editor zeichnet nur.** Der Baukasten bearbeitet die
vier Bausteine und stellt das Ergebnis als Kette dar. Ziehen sortiert um,
Verbinden gibt es nicht. Keine Schemaänderung. Nachteil: Was optisch nach
freiem Verbinden aussieht, ist es nicht — die Oberfläche verspricht mehr, als
das Modell hält, und das fällt beim ersten Verzweigungswunsch auf.

**A2 — Kantenmodell.** Eine Tabelle `prozess_uebergang` (von Stufe, nach
Stufe, Bedingung). Die heutige Kette ist darin der Sonderfall „genau eine
ausgehende Kante je Stufe". Verzweigung, Zusammenführung und Rücksprung sind
ausdrückbar. Kosten: Die Engine traversiert statt hochzuzählen, und ein Lauf
kann mehrere aktive Stufen gleichzeitig haben.

**A3 — Fremde Engine, etwa BPMN.** Ausgereifte Editoren und Ausführung von der
Stange. Abgelehnt: zweite Infrastruktur neben Postgres, fremde Fachbegriffe in
einer bewusst deutschen Domäne, und die Stempelkette mit ihrer
GoBD-Protokollpflicht müsste doppelt geführt werden — einmal in der Engine,
einmal bei uns. Der Nutzen liegt im Editor, nicht in der Ausführung; einen
Editor kann man einbinden, ohne die Ausführung abzugeben.

### Empfehlung

**A2.** Wer freies Verbinden in der Oberfläche will, braucht Kanten im Modell.
A1 wäre ehrlich nur mit einer Oberfläche, die ausdrücklich keine Pfeile zeigt.

Skizze:

```sql
create table prozess_uebergang (
  id              uuid primary key default gen_random_uuid(),
  definition_id   uuid not null references prozessdefinition(id) on delete cascade,
  -- NULL = Einstieg in den Ablauf
  von_stufe_id    uuid references prozessstufe(id) on delete cascade,
  -- NULL = Ende des Ablaufs
  nach_stufe_id   uuid references prozessstufe(id) on delete cascade,
  bedingung       jsonb,
  sortierung      integer not null default 0,
  check (von_stufe_id is not null or nach_stufe_id is not null)
);
```

`prozessstufe.reihenfolge` bleibt als topologische Ordnung erhalten — sie wird
für den Rücksprung beim gebrochenen Freigabe-Hash gebraucht, der „auf die
erste betroffene Stufe" zurückgeht. Ohne eine Ordnung ist „erste" in einem
Graphen nicht definiert.

---

## Teil B · Bedingungen

### Optionen

**B1 — Betragsgrenzen, wie heute.** Reicht für die Standardkette, nicht für
einen Baukasten: Sobald jemand Kanten ziehen kann, will er nach Ordnungsgruppe,
Belegart, Kreditor oder Objektmerkmal verzweigen.

**B2 — Strukturierter Ausdruck als `jsonb`,** über einer festen Feldliste,
serverseitig ausgewertet. Beispiel:

```json
{ "und": [
  { "feld": "brutto", "op": ">", "wert": 5000 },
  { "feld": "ordnungsgruppe.kurzcode", "op": "=", "wert": "VS" }
]}
```

Die Feldliste ist eine Weißliste im Code. Was nicht daraufsteht, lässt sich
nicht auswählen — der Editor bietet nur an, was die Engine auswerten kann.

**B3 — Freitext oder Skript.** Abgelehnt. Das ist wieder Code, nur an einer
Stelle, an der ihn niemand prüft, testet oder versioniert — und in einem
System mit mandantengetrennten Daten zusätzlich ein Sicherheitsproblem.

### Empfehlung

**B2.** Die Weißliste ist der entscheidende Teil: Sie hält den Baukasten
davon ab, eine Programmiersprache zu werden.

---

## Teil C · Übertragung an Rolle oder Mitarbeiter

Hier ist zwischen drei Dingen zu unterscheiden, die umgangssprachlich alle
„übertragen" heißen.

| Was | Heute | Bewertung |
|---|---|---|
| Eine **Aufgabe** einem anderen geben | `zuweisung_ereignis`, protokolliert | vorhanden |
| **Zuständigkeit** dauerhaft ändern | `objekt_zustaendigkeit`, datiert | vorhanden |
| **Rechte** temporär übertragen | nicht vorgesehen | bleibt ausgeschlossen |

### Optionen

**C1 — Beim Bestand bleiben.** Einzelzuweisung und Stammdatenpflege. Deckt
„Herr A macht diesen Beleg für Frau B" ab, aber nicht „Frau B ist drei Wochen
im Urlaub, alles Technische geht so lange an Herrn A".

**C2 — Delegation als eigenes Objekt.** Von wem, an wen, in welchem Umfang,
in welchem Zeitfenster, protokolliert:

```sql
create table delegation (
  id              uuid primary key default gen_random_uuid(),
  mandant_id      uuid not null references mandant(id),
  von_benutzer    uuid not null references benutzer(id),
  an_benutzer     uuid not null references benutzer(id),
  -- Teilweise Übertragung: leer = alles, sonst Einschränkung
  objekt_id       uuid references objekt(id),
  ordnungsgruppe_id uuid references ordnungsgruppe(id),
  stufentyp       text,
  gueltig_von     timestamptz not null,
  gueltig_bis     timestamptz,
  grund           text,
  erstellt_von    uuid not null references benutzer(id),
  erstellt_am     timestamptz not null default now(),
  widerrufen_am   timestamptz
);
```

Die Engine wertet sie beim **Zuweisen einer Aufgabe** aus, nicht beim Prüfen
von Rechten. Wirkung: Die Aufgabe landet bei Herrn A. Nicht-Wirkung: Herr A
bekommt keine Rechte von Frau B; was er nicht darf, darf er weiterhin nicht,
und die Aufgabe eskaliert dann regulär.

**C3 — Echte Rechteübertragung.** Abgelehnt, siehe Kontext.

### Empfehlung

**C2**, zusammen mit dem Rollenmodell aus §17 — ohne `rolle` gibt es kein
Ziel für „an eine andere Rolle übertragen", und der Platzhalter
`globaler_objektzugriff` trägt das nicht.

Am Stempel ist zusätzlich sichtbar zu machen, dass er aufgrund einer
Delegation gesetzt wurde. Sonst steht später ein Name im Protokoll, dessen
Zuständigkeit sich aus den Stammdaten nicht erklärt.

---

## Abweichung vom Konzept

Mit A2 und einem optischen Editor wird §8.8 aufgehoben — dort steht „Kein
Prozessdesigner". Das ist eine bewusste Änderung der Anforderung, keine
Korrektur eines Fehlers. Der Grund für die ursprüngliche Entscheidung bleibt
allerdings gültig und wird zur Auflage: Ein Graph, den man frei zeichnen kann,
lässt sich auch falsch zeichnen. Deshalb sind zwei Dinge nicht optional.

**Gültigkeitsprüfung.** Vor dem Aktivieren einer Fassung: Ist jede Stufe vom
Einstieg aus erreichbar? Führt jeder Pfad zu einem Ende? Hat jede parallele
Aufspaltung eine Zusammenführung? Gibt es Zyklen ohne Ausstieg? Sind alle
Bedingungen zusammen vollständig, oder gibt es einen Fall ohne ausgehende
Kante?

**Simulation.** §8.8 sieht sie bereits vor: „Rechnung über 3.000 €, Objekt 42,
Ordnungsgruppe Technik" zeigt die resultierende Kette samt Zuständigen. Bei
einem Graphen ist sie nicht mehr Komfort, sondern das einzige Mittel, eine
Konfiguration vor dem Scharfschalten zu verstehen.

---

## Konsequenzen

**Eine Migration vor der Engine.** `prozess_uebergang`, `bedingung` an Stufe
und Kante, `delegation`, dazu das Rollenmodell aus §17. Danach wäre sie ein
Umbau an laufenden Belegen.

**Der Lauf hat nicht mehr eine aktuelle Stufe, sondern mehrere.**
`dokument_lauf.aktuelle_stufe_id` ist als Cache eines einzelnen Werts angelegt.
Bei parallelen Zweigen wird er mehrdeutig; die aktiven Stufen sind dann aus
den offenen Aufgaben abzuleiten, und der Cache entfällt oder wird zur Liste.

**Der Rücksprung braucht eine Ordnung.** Bricht der Freigabe-Hash, springt die
Engine „auf die erste betroffene Stufe" zurück. In einem Graphen ist das nur
über die beibehaltene topologische Ordnung definierbar.

**Die Bestandsdefinitionen sind zu überführen.** Aus jeder Kette wird eine
Folge von Kanten. Das ist eine Datenmigration, keine Handarbeit.

**Der Editor braucht ein Layout.** Knotenpositionen sind Darstellung, keine
Fachlogik — eigene Spalte oder eigene Tabelle, nie in `prozessstufe`.

**Der Aufwand steigt spürbar.** Kette plus Liste ist in Tagen zu bauen; Graph
plus Editor plus Validierung plus Simulation ist ein eigenes Modul. Das ist
der Preis für die Anforderung, nicht ein Argument dagegen — er sollte nur
bekannt sein, bevor er anfällt.

---

## Offen

- Soll der Editor eine fertige Zeichenbibliothek nutzen (bpmn-js, React Flow)
  oder eine eigene, auf die vier Bausteine zugeschnittene Fläche? Eine fertige
  Bibliothek bringt Fachbegriffe mit, die nicht die unseren sind.
- Dürfen Rücksprungkanten frei gezogen werden, oder bleibt der Rücksprung der
  Engine vorbehalten (Klärung, verfallener Freigabe-Hash)? Frei gezogene
  Rückwärtskanten sind die häufigste Quelle für Endlosläufe.
- Wie verhält sich eine Delegation zur Eskalation, wenn beide gleichzeitig
  greifen?
