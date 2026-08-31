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
| **Blockbaum** | Der Ablauf als geschachtelte Bausteine: nacheinander, gleichzeitig, Verzweigung, Stufe. Bausteine rasten ineinander, statt frei verbunden zu werden. |
| **Bedingung** | Regel an einer Verzweigung, aufgebaut aus einer festen Feldliste. Kein Freitext, kein Skript. |
| **Stufe** | Eine Station im Lauf: sachliche Prüfung, Kontierung, Freigabe … |
| **Aufgabe** | Was in einem Postfach erscheint. Alle drei Postfächer sind nur Sichten darauf. |
| **Stempel** | Eine getroffene Entscheidung, festgehalten als Ereignis. Sagt *nicht*, wohin der Beleg als Nächstes geht. |
| **Klärung** | Beleg wird geparkt, mit Pflichtkommentar und Wiedervorlagedatum. Die Stempel bleiben gültig. |
| **Kontierung** | Aufteilung des Betrags auf Konten, zeilenweise, mit Umlagefähigkeit je Zeile. |
| **Ampel** | Zwei Werte: wie sicher wurde gelesen (Extraktion), und wie plausibel ist das Ergebnis. Der schlechtere gewinnt. |
| **Rolle** | Bündel von Rechten, einem Benutzer je Objekt oder mandantenweit zugewiesen. Mehrere Rollen ergänzen sich; eine Rolle entzieht nie ein Recht. |
| **Kreditor** | Lieferant, Dienstleister, Rechnungssteller. |
| **Vertretung** | Zeitweises Umlenken neuer Aufgaben an eine andere Person. Überträgt keine Rechte. |
| **Vorgang** | Klammer um mehrere Belege: ein Schadensfall, ein Rechtsstreit, ein Mieterwechsel. |

---

## Wie die Rechnungsdaten ins System kommen

Drei Wege, in dieser Reihenfolge.

**Strukturierte Rechnung.** ZUGFeRD und XRechnung tragen ihre Daten als XML
mit — im PDF eingebettet oder als reine XML-Datei. Daraus wird direkt gelesen:
Kreditor, Rechnungsnummer, Datum, Beträge, IBAN, Leistungszeitraum. Hier gibt
es nichts zu raten, die Ampel steht auf Grün. Kein Modell, keine Kosten, keine
Daten außer Haus.

**Lokales Modell.** Für gewöhnliche PDFs, wenn eingeschaltet. Es läuft auf
eigener Hardware und bekommt nur den Text, den die Aufbereitung ohnehin schon
gelesen hat. Einschalten über die Umgebungsvariable `DMS_EXTRAKTION=ollama`.

**Gar nichts.** Die Voreinstellung. Ohne eingeschaltetes Modell und ohne
eingebettetes XML wird nicht geraten: Der Beleg läuft weiter, die Ampel steht
auf Rot, und die Felder werden von Hand erfasst.

Zwei Regeln, die im Zweifel gelten:

**Ein fehlendes Feld ist besser als ein geratenes.** Was nicht sicher erkannt
wurde, bleibt leer und landet in der manuellen Erfassung — nicht in einer
stillen Fehlbuchung.

**Was ein Mensch bestätigt hat, wird nicht überschrieben.** Eine spätere
Erkennung füllt nur, was leer ist.

Die Ampel für die Extraktion ist das **Minimum** über die Pflichtfelder
Kreditor, Rechnungsnummer, Datum und Bruttobetrag — nicht der Durchschnitt.
Ein unsicher gelesener Betrag wird nicht dadurch besser, dass der
Lieferantenname eindeutig war.

> Noch nicht gebaut: die Plausibilitätsprüfungen und damit die Gesamtampel —
> darunter die harten Fälle „IBAN passt nicht zum Kreditor" und „Dublette".


---

## Die Ampel

Zwei Werte, weil zwei verschiedene Fragen dahinterstehen.

**Extraktion** — wie sicher wurde gelesen? Bei einer strukturierten Rechnung
ist das per Definition sicher. Bei einem Modell ist es dessen eigene
Einschätzung, gedeckelt.

**Plausibilität** — ergibt das Gelesene fachlich Sinn? Ein Beleg kann perfekt
gelesen und trotzdem falsch sein.

**Die Gesamtampel ist der schlechtere der beiden.** Grün nur, wenn beide grün
sind.

### Was geprüft wird

| Prüfung | Wirkung |
|---|---|
| Bankverbindung gehört zum Kreditor | **hält an** |
| Dublette: Kreditor + Rechnungsnummer + Betrag | **hält an** |
| Netto + Steuer ergibt den Rechnungsbetrag | orange |
| Pflichtangaben nach § 14 UStG vollständig | orange |
| Kreditor zugeordnet | orange |
| Betrag innerhalb der Vertragstoleranz | orange |

Die ersten beiden **färben nicht nur, sie halten an**: Der Lauf geht in
Klärung, es sind keine Stempel mehr möglich, und der Beleg erscheint im
Klärungspostfach. Bei beiden wäre der Schaden groß und die Korrektur teuer —
eine gefälschte Bankverbindung sieht man dem Beleg nicht an, und eine doppelt
gezahlte Rechnung holt man sich mühsam zurück.


### Mahnungen

Eine Mahnung läuft nicht wie ein gewöhnlicher Beleg durch. Sie ist keine
Forderung, die man bezahlt, sondern eine Aussage über eine andere Forderung.
Deshalb sucht das System die Ursprungsrechnung — über Kreditor und
Rechnungsnummer, **nicht** über den Betrag, denn eine Mahnung trägt
Mahngebühren — und wertet deren Zustand aus:

| Zustand der Rechnung | Reaktion |
|---|---|
| abgeschlossen und archiviert | **hält an** — Doppelzahlungsgefahr |
| noch im Lauf | orange, mit Stufe und Liegezeit |
| in Klärung | orange, nennt den Verantwortlichen |
| nicht auffindbar | orange — der Beleg fehlt im System |

In allen Fällen, in denen eine Rechnung gefunden wird, werden beide
verkettet — auch wenn der Befund harmlos ist. Sie gehören in dieselbe Akte.

Der letzte Fall ist der übersehene: Eine Mahnung ohne auffindbare Rechnung ist
oft der einzige Hinweis darauf, dass ein Beleg nie angekommen ist. Das fällt
sonst erst auf, wenn die Frist längst abgelaufen ist.

> Noch offen: Dass eine Mahnung **nie separat bezahlt** wird, ist bisher ein
> Hinweistext und keine Sperre — das Zahlungsmodul gibt es noch nicht.

### Warum die Hinweise im Klartext stehen

Jeder Befund trägt einen Satz, der sagt, was zu tun ist. Eine rote Ampel ohne
Begründung wäre ein Rätsel: Der Bearbeiter würde selbst suchen, was auffällig
ist, und das kostet mehr Zeit, als die Prüfung spart. Die Hinweise stehen am
Beleg und an der Aufgabe.

Wird ein Befund behoben — etwa der Kreditor zugeordnet — verschwindet er beim
nächsten Prüflauf, und die Ampel färbt sich zurück.

> Noch nicht geprüft: ob das Wirtschaftsjahr offen ist und ob die
> Budgetgrenze eingehalten wird. Beides braucht Daten, die es noch nicht gibt
> — einen Jahresabschluss und das verbrauchte Budget aus der Kontierung.


---

## Abläufe ändern

Unter *Abläufe* steht je Belegart und Ordnungsgruppe die aktive Fassung, dazu
die abgelösten in einem aufklappbaren Bereich. Abgelöst heißt nicht ungültig:
Belege, die vor der Umstellung gestartet sind, laufen in ihrer Fassung zu Ende.
Die Spalte *laufende Belege* zeigt, wie viele das sind.

**Ändern geht nur über einen Entwurf.** Die aktive Fassung wird nie
bearbeitet. Ein Entwurf ist eine vollständige Kopie mit eigenen Stufen — sonst
würde eine Änderung rückwirkend die Belege betreffen, die gerade unterwegs
sind. Es gibt höchstens einen Entwurf je Ablauf; wer ihn angelegt hat, steht
dabei.

Der Ablauf ist eine verschachtelte Liste aus vier Bausteinen:

| Baustein | Bedeutung |
|---|---|
| **Stufe** | eine Station: sachliche Prüfung, Kontierung, Freigabe |
| **Nacheinander** | was darin steht, läuft der Reihe nach |
| **Gleichzeitig** | was darin steht, läuft parallel; endet, wenn alles fertig ist |
| **Wenn / Sonst** | zwei Zweige, gewählt über eine Bedingung |

Weil die Bausteine ineinander rasten, können die typischen Fehler nicht
entstehen: Es gibt keine Aufspaltung ohne Zusammenführung, keine unerreichbare
Stufe, keine Endlosschleife.

Rechts stehen **Prüfung** und **Simulation**. Die Prüfung meldet, was die
Bauart offen lässt — ein leerer Behälter etwa, oder eine Stufe, die nicht
eingehängt ist. Die Simulation zeigt die Kette für einen gedachten Beleg;
ändert man den Betrag, ändert sich die Kette entsprechend. Beides steht vor
dem Knopf *Fassung aktivieren*, und das ist Absicht: Ein Entwurf mit Fehlern
lässt sich nicht scharfschalten.

Wer aktiviert, wird protokolliert. Eine Änderung am Ablauf ist eine
Entscheidung — im Prüfungsfall ist sie die Erklärung dafür, warum ein Beleg
seinen Weg genommen hat.

> Das Recht dazu heißt `prozess_konfigurieren` und hat nicht jeder. Wer
> stempeln darf, darf noch lange nicht den Ablauf ändern — das trifft alle.


---

## Vertretung

Unter *Vertretung* gibt man seine Aufgaben für eine Zeit an jemand anderen ab —
Urlaub, Krankheit, Projektarbeit. Der Umfang lässt sich einschränken: nur ein
Objekt, nur eine Ordnungsgruppe, nur eine Stufenart.

Drei Punkte, die im Alltag zählen:

**Es wandert die Aufgabe, nicht das Recht.** Wer vertritt, sieht die Belege im
eigenen Postfach — entscheiden darf er nur, was seine eigenen Rollen hergeben.
Vertritt die Buchhaltung die Objektbearbeitung, bekommt sie den Beleg, kann ihn
aber nicht sachlich freigeben; die Aufgabe eskaliert dann regulär. Das wirkt
zunächst unbequem und ist der Grund, warum im November noch feststellbar ist,
wer im März was entscheiden durfte.

**Es wirkt auf neue Aufgaben.** Was bereits zugewiesen ist, bleibt liegen, wo
es liegt. Für den Einzelfall gibt es die Zuweisung von Hand.

**Es gilt eine Stufe weit.** Vertritt A an B und B an C, geht die Aufgabe an B.
Eine Kette wäre schwer zu durchschauen und könnte im Kreis laufen.

Am Stempel bleibt vermerkt, dass eine Vertretung gewirkt hat — sonst stünde
später ein Name im Protokoll, dessen Zuständigkeit sich aus den Stammdaten
nicht erklärt.

Für sich selbst darf jeder eine Vertretung einrichten. Für einen anderen —
etwa bei unerwartetem Ausfall — braucht es das Recht `delegieren`.


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

## Die drei Postfächer

Alle drei sind Sichten auf dieselben Daten, kein eigener Ablageort.

**Persönlich** — was namentlich zugewiesen ist. Der Objektverantwortliche
bekommt die sachliche Prüfung seiner Objekte hierhin.

**Pool: Spezialgebiet und Rolle** — was einer Gruppe oder einer Rolle gehört,
nicht einer Person. Die rechnerische Prüfung liegt bei der Buchhaltung, die
Freigabe bei der Geschäftsleitung; alle, die die Rolle für dieses Objekt
tragen, sehen die Aufgabe. Wer sie übernimmt, sperrt sie für eine Weile.

**Klärung** — persönlich, mit Wiedervorlagedatum. Der Beleg ist geparkt, die
bisherigen Stempel bleiben gültig.

Ein Klick auf einen Beleg öffnet die Aufgabe: Vorschau, Kopfdaten und die
Schaltflächen, die an dieser Stufe **und** mit diesen Rechten möglich sind —
in der Regel zwei oder drei. Es gibt kein Zielfeld: Wohin der Beleg danach
geht, leitet die Engine ab.

Wer an einer Stufe keinen passenden Stempel hat, sieht das ausdrücklich und
die Aufgabe bleibt offen. Das ist kein Fehler, sondern die Antwort auf eine
Konfiguration, in der jemand zwar den Beleg sehen, aber nicht entscheiden darf.


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
Die Sicht kommt aus zwei Quellen, die sich ergänzen: der Objektzuständigkeit
und einer Rollenzuweisung. Beide sind datiert — ein abgelaufenes `gueltig_bis`
nimmt die Sicht sofort, aber nur, wenn auch die andere Quelle nicht trägt.
Buchhaltung und Geschäftsleitung tragen keine Zuständigkeit; sie haben eine
Rolle ohne Objektbezug und sehen damit alle Objekte des Mandanten.

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
| `docs/messungen.md` | Gemessene Zahlen mit Aufbau und Bedingungen. |
| `supabase/migrations/` | Das Schema, als handgeschriebenes DDL. |
| `supabase/seed.sql` | Synthetische Ausgangsdaten. |
| `src/` | Anwendungscode. |
| `tests/` | Tests gegen eine echte Datenbank. |
| `.claude/agents/` | Rollenbeschreibungen für die KI-Agenten. |
