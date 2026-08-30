# 0002 · Workflow-Modell: Blockstruktur, Bedingungen, Delegation

Stand: 30. August 2026 · angenommen

## Kontext

Die Anforderung lautet: Der Ablauf soll vollständig dynamisch sein — änderbar,
ergänzbar, anpassbar — und in einem optischen Baukasten gepflegt werden,
vergleichbar mit den Editoren von puzzleapp.io. Zusätzlich soll er sich für
eine Rolle oder einen einzelnen Mitarbeiter ganz oder teilweise auf andere
übertragen lassen. Leitplanken sind maximale Flexibilität und
Benutzerfreundlichkeit **innerhalb** von Sicherheit, Skalierbarkeit und
Mehrbenutzerbetrieb.

Dem stehen drei Festlegungen gegenüber.

**Das Konzept lehnt einen Prozessdesigner ab.** §8.8 beginnt mit dem Satz
„Kein Prozessdesigner" und begründet das: Vier Bausteine — Reihenfolge,
Zuständigkeit, Bedingung, erlaubte Stempel — genügen für den gesamten
beschriebenen Ablauf, und eine sortierbare Liste ist für Sachbearbeiter
bedienbarer als eine Zeichenfläche.

**Das gebaute Modell ist eine Kette.** `prozessstufe` trägt `reihenfolge` und
`parallelgruppe`; gleiche Gruppennummer heißt „gleichzeitig, Reihenfolge egal,
alle müssen abschließen". Eine Struktur darüber hinaus gibt es nicht.
Bedingungen existieren nur als `betrag_von` / `betrag_bis`.

**Rechte werden nicht übertragen.** Entscheidung 8 im Konzept: Vertretung
läuft über die Eskalation, die Aufgabe wandert, die Rolle bleibt. Ein
Rechtemodell, das sich temporär verschiebt, ist im Prüfungsfall nicht mehr
beantwortbar — wer im März freigeben durfte, muss im November feststellbar
sein.

Nicht gebaut ist außerdem das Rollenmodell aus §17 (`rolle`, `rolle_recht`,
`benutzer_rolle_objekt`); an seiner Stelle steht der Platzhalter
`benutzer.globaler_objektzugriff`.

---

## Teil A · Ablaufmodell

### Optionen

**A1 — Kette behalten, Editor zeichnet nur.** Der Baukasten bearbeitet die
vier Bausteine und stellt das Ergebnis als Kette dar. Keine Schemaänderung.
Nachteil: Was optisch nach freiem Verbinden aussieht, ist es nicht — die
Oberfläche verspricht mehr, als das Modell hält, und das fällt beim ersten
Verzweigungswunsch auf.

**A2 — Freier Graph.** Eine Kantentabelle `prozess_uebergang` (von Stufe, nach
Stufe, Bedingung). Maximale Ausdrucksstärke — und die Erlaubnis, jeden Fehler
zu zeichnen, den man zeichnen kann: unerreichbare Stufen, aufgespaltene Zweige
ohne Zusammenführung, Endlosschleifen. Das verlangt eine Gültigkeitsprüfung,
die Fehler **hinterher** meldet.

**A3 — Blockstruktur.** Bausteine rasten ineinander, statt frei verbunden zu
werden — das Prinzip, nach dem Editoren mit Puzzleteilen arbeiten. Vier
Knotenarten genügen:

| Baustein | Bedeutung |
|---|---|
| **Stufe** | eine Station: sachliche Prüfung, Kontierung, Freigabe |
| **Nacheinander** | enthält Bausteine, die der Reihe nach laufen |
| **Gleichzeitig** | enthält Bausteine, die parallel laufen; endet, wenn alle fertig sind |
| **Wenn / Sonst** | enthält zwei Zweige, gewählt über eine Bedingung |

Jede Aufspaltung ist damit automatisch zusammengeführt, jede Stufe erreichbar,
jeder Pfad endlich: **gültig durch Bauart** statt gültig laut nachträglicher
Prüfung.

**A4 — Fremde Engine, etwa BPMN.** Ausgereifte Editoren und Ausführung von der
Stange. Abgelehnt: zweite Infrastruktur neben Postgres, fremde Fachbegriffe in
einer bewusst deutschen Domäne, und die Stempelkette mit ihrer
GoBD-Protokollpflicht müsste doppelt geführt werden — einmal in der Engine,
einmal bei uns. Der Nutzen liegt im Editor, nicht in der Ausführung.

### Entscheidung

**A3, Blockstruktur.**

Sie bedient die drei Leitplanken gleichzeitig, statt sie gegeneinander
auszuspielen. Gegenüber A2 verliert sie kaum Ausdrucksstärke — der gesamte
Ablauf aus dem Konzept, einschließlich Nebenläufe und Wartecontainer, lässt
sich als Blockbaum ausdrücken. Was wegfällt, ist die frei gezogene
Rückwärtskante, und die war die Hauptquelle für Endlosläufe. Rücksprünge
bleiben der Engine vorbehalten, wo sie fachlich definiert sind: Klärung und
verfallener Freigabe-Hash.

Im Schema ist A3 zudem **einfacher** als A2 — es entfällt eine Tabelle,
statt eine hinzuzukommen:

```sql
create table prozessknoten (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references prozessdefinition(id) on delete cascade,
  eltern_id     uuid references prozessknoten(id) on delete cascade,
  reihenfolge   integer not null,
  knotentyp     text not null check (knotentyp in
                  ('nacheinander','gleichzeitig','verzweigung','stufe')),
  bedingung     jsonb,                            -- nur bei verzweigung
  stufe_id      uuid references prozessstufe(id)  -- nur bei stufe
);
```

`prozessstufe` bleibt unverändert: Die Stufen behalten ihre stabilen
Kennungen, an denen Aufgaben, Stempelereignisse und Objekt-Overrides hängen.
`reihenfolge` bleibt außerdem die topologische Ordnung, die der Rücksprung
beim gebrochenen Freigabe-Hash braucht — „die erste betroffene Stufe" ist ohne
Ordnung nicht definiert.

Die Engine läuft den Baum ab, statt einen Zähler hochzusetzen.

---

## Teil B · Bedingungen

### Optionen

**B1 — Betragsgrenzen, wie heute.** Reicht für die Standardkette, nicht für
einen Baukasten: Sobald jemand Verzweigungen einsetzen kann, will er nach
Ordnungsgruppe, Belegart, Kreditor oder Objektmerkmal verzweigen.

**B2 — Strukturierter Ausdruck als `jsonb`,** über einer festen Feldliste,
serverseitig ausgewertet:

```json
{ "und": [
  { "feld": "brutto", "op": ">", "wert": 5000 },
  { "feld": "ordnungsgruppe.kurzcode", "op": "=", "wert": "VS" }
]}
```

**B3 — Freitext oder Skript.** Abgelehnt. Das ist wieder Code, nur an einer
Stelle, an der ihn niemand prüft, testet oder versioniert — und in einem
System mit mandantengetrennten Daten zusätzlich ein Sicherheitsproblem.

### Entscheidung

**B2.** Die Feldliste ist eine Weißliste im Code; der Editor bietet nur an,
was die Engine auswerten kann. Sie ist der entscheidende Teil — sie hält den
Baukasten davon ab, schleichend eine Programmiersprache zu werden.

Ausgewertet wird ausschließlich serverseitig und **nie in einer RLS-Policy**.
Der Baum wird einmal je Beleg durchlaufen, nicht je Zeile; die Auswertung
skaliert damit unabhängig von der Belegzahl.

---

## Teil C · Übertragung an Rolle oder Mitarbeiter

Drei Dinge heißen umgangssprachlich „übertragen" und sind verschieden:

| Was | Heute | Bewertung |
|---|---|---|
| Eine **Aufgabe** einem anderen geben | `zuweisung_ereignis`, protokolliert | vorhanden |
| **Zuständigkeit** dauerhaft ändern | `objekt_zustaendigkeit`, datiert | vorhanden |
| **Rechte** temporär übertragen | nicht vorgesehen | bleibt ausgeschlossen |

### Optionen

**C1 — Beim Bestand bleiben.** Deckt „Herr A macht diesen Beleg für Frau B"
ab, aber nicht „Frau B ist drei Wochen im Urlaub, alles Technische geht so
lange an Herrn A".

**C2 — Delegation als eigenes Objekt.** Von wem, an wen, in welchem Umfang, in
welchem Zeitfenster, protokolliert:

```sql
create table delegation (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  von_benutzer      uuid not null references benutzer(id),
  an_benutzer       uuid not null references benutzer(id),
  -- Teilweise Übertragung: leer = alles, sonst Einschränkung
  objekt_id         uuid references objekt(id),
  ordnungsgruppe_id uuid references ordnungsgruppe(id),
  stufentyp         text,
  gueltig_von       timestamptz not null,
  gueltig_bis       timestamptz,
  grund             text,
  erstellt_von      uuid not null references benutzer(id),
  erstellt_am       timestamptz not null default now(),
  widerrufen_am     timestamptz
);
```

**C3 — Echte Rechteübertragung.** Abgelehnt, siehe Kontext.

### Entscheidung

**C2**, zusammen mit dem Rollenmodell aus §17 — ohne `rolle` gibt es kein Ziel
für „an eine andere Rolle übertragen", und der Platzhalter
`globaler_objektzugriff` trägt das nicht.

Die Delegation wirkt beim **Zuweisen einer Aufgabe**, nicht beim Prüfen von
Rechten. Wirkung: Die Aufgabe landet bei Herrn A. Nicht-Wirkung: Herr A
bekommt keine Rechte von Frau B; was er nicht darf, darf er weiterhin nicht,
und die Aufgabe eskaliert dann regulär.

Am Stempel ist sichtbar zu machen, dass er aufgrund einer Delegation gesetzt
wurde. Sonst steht später ein Name im Protokoll, dessen Zuständigkeit sich aus
den Stammdaten nicht erklärt.

**Keine Abläufe je Mitarbeiter.** Das klingt nach Flexibilität und ist eine
kombinatorische Falle: Bei fünfzig Mitarbeitern hat niemand mehr einen
Überblick, und „warum ging dieser Beleg dorthin" wird unbeantwortbar. Die drei
Werkzeuge sind Zuständigkeit (dauerhaft), Override je Objekt (Ausnahme) und
Delegation (vorübergehend).

---

## Bedienung

Der häufigste Fehler bei Baukästen ist, allen dieselbe Oberfläche zu geben.
Es gibt drei Publika:

**Der Sachbearbeiter sieht den Baukasten nie.** Er bekommt weiterhin zwei oder
drei Schaltflächen — „Sachlich richtig", „Zur Klärung", „Ablehnen" —,
bestimmt aus aktueller Stufe und seinen Rechten. Das bleibt unangetastet.

**Der Objektverantwortliche pflegt Ausnahmen, keine Prozesse.** „WEG A:
Beiratsfreigabe ab 1.000 €" ist eine Zeile in einer Liste; `prozess_override`
kann das bereits. Kein Diagramm für einen Schwellwert.

**Nur wenige konfigurieren.** Für sie ist die Simulation aus §8.8 Pflicht,
nicht Komfort: „Rechnung über 3.000 €, Objekt 42, Ordnungsgruppe Technik"
zeigt die resultierende Kette samt Zuständigen — vor dem Scharfschalten.

Zur Oberfläche: Für eine Blockstruktur braucht es **keine Zeichenfläche**.
Eine verschachtelte Liste mit Ziehen und Ablegen ist weniger Code, funktioniert
auf dem Tablet, ist mit der Tastatur bedienbar und lässt sich zeilenweise
vergleichen — „was ändert sich gegenüber der aktiven Fassung" wird damit ein
lesbarer Unterschied statt zweier Bilder.

## Mehrbenutzerbetrieb

Kein gleichzeitiges Bearbeiten derselben Fassung. Je Definition gibt es
höchstens **einen Entwurf** mit einem Eigentümer; wer ihn öffnet, während ein
anderer daran arbeitet, bekommt ihn lesend und sieht, bei wem er liegt.

Aktiviert wird ausdrücklich, und die Aktivierung ist ein protokolliertes
Ereignis mit Urheber, Zeitpunkt und Unterschied — dieselbe Logik wie bei den
Stempeln. Laufende Belege behalten ihre Fassung; das ist über
`dokument_lauf.definition_version` bereits gebaut.

---

## Abweichung vom Konzept

§8.8 sagt „Kein Prozessdesigner". Das wird aufgehoben — als bewusste Änderung
der Anforderung, nicht als Korrektur eines Fehlers.

Der Grund der ursprünglichen Entscheidung bleibt gültig: Ein Ablauf, den man
frei gestalten kann, lässt sich auch falsch gestalten. Die Blockstruktur nimmt
diesem Einwand den größten Teil seiner Kraft, weil die typischen Fehler
strukturell nicht entstehen. Was übrig bleibt, deckt die Simulation ab.

---

## Konsequenzen

**Eine Migration vor der Engine.** `prozessknoten`, `bedingung` als `jsonb`,
`delegation`, dazu das Rollenmodell aus §17. Danach wäre es ein Umbau an
laufenden Belegen.

**Der Lauf hat nicht mehr eine aktuelle Stufe, sondern mehrere.**
`dokument_lauf.aktuelle_stufe_id` ist als Cache eines einzelnen Werts
angelegt. Bei parallelen Zweigen wird er mehrdeutig; die aktiven Stufen sind
dann aus den offenen Aufgaben abzuleiten, und der Cache entfällt oder wird zur
Liste.

**Die Bestandsdefinitionen sind zu überführen.** Aus jeder Kette wird ein Baum
mit einem `nacheinander`-Wurzelknoten; aus jeder `parallelgruppe` ein
`gleichzeitig`-Knoten. Das ist eine Datenmigration, keine Handarbeit.

**Konfigurieren braucht ein eigenes Recht** — und damit zuerst das
Rollenmodell. Solange nur `globaler_objektzugriff` existiert, gibt es keine
saubere Antwort auf „wer darf den Ablauf ändern".

**Der Editor braucht ein Layout — aber wenig davon.** Bei einer verschachtelten
Liste ergibt sich die Darstellung aus dem Baum; zu speichern ist höchstens der
auf- oder zugeklappte Zustand, und der gehört zum Benutzer, nicht zur
Definition.

**Der Aufwand steigt spürbar.** Kette plus sortierbare Liste wären in Tagen zu
bauen; Blockbaum plus Engine plus Simulation plus Editor ist ein eigenes
Modul. Das ist der Preis für die Anforderung, kein Argument dagegen — er
sollte nur bekannt sein, bevor er anfällt.

## Reihenfolge

1. **Rollenmodell §17** — blockiert alles andere: Recht am Baukasten, Ziel der
   Delegation
2. **`prozessknoten` und Bedingungen** mit Weißliste
3. **Engine als Baumdurchlauf**, dazu die Simulation
4. **Editor** als verschachtelte Ziehen-und-Ablegen-Liste
5. **Delegation** mit Umfang und Zeitfenster

Punkt 1 bis 3 sind das Fundament, Punkt 4 ist Oberfläche und kann jederzeit
nachkommen — der Baukasten setzt dann nur zusammen, was die Engine ohnehin
versteht.

## Aufgelöste Fragen

Die drei offenen Punkte der vorgeschlagenen Fassung sind mit A3 beantwortet:

- **Zeichenbibliothek oder eigene Fläche?** Weder noch — eine verschachtelte
  Liste. Eine Leinwand wäre die aufwendigere und schlechter bedienbare Lösung
  für dieselbe Aufgabe.
- **Frei gezogene Rücksprungkanten?** Gibt es nicht. Rücksprünge bleiben der
  Engine vorbehalten.
- **Delegation und Eskalation gleichzeitig?** Die Delegation wirkt beim
  Zuweisen, die Eskalation danach auf der zugewiesenen Aufgabe. Eine an Herrn
  A delegierte Aufgabe eskaliert also über Herrn A weiter, nicht über Frau B.
