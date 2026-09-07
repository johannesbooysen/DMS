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

### Anmeldung einrichten

Die Anwendung startet **nicht** ohne eingerichtete Anmeldung. Das ist Absicht
— ein System, das im Zweifel jeden hereinlässt, wäre schlimmer als eines, das
nicht startet.

Für den Betrieb braucht es eine App-Registrierung in Microsoft Entra. Die
kann nur jemand mit Adminrechten im Microsoft-Mandanten anlegen. Nötig sind
dort: eine Umleitungs-URI vom Typ *Web* auf
`https://ihre-adresse/api/anmeldung/rueckkehr` und ein Clientgeheimnis.

```
ENTRA_TENANT_ID=…            # Verzeichnis-ID (Mandant)
ENTRA_CLIENT_ID=…            # Anwendungs-ID (Client)
ENTRA_CLIENT_SECRET=…        # Clientgeheimnis
DMS_BASIS_URL=https://…      # ohne Schrägstrich am Ende
DMS_SITZUNGS_GEHEIMNIS=…     # mindestens 32 Zeichen
```

Das Sitzungsgeheimnis erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Solange es keine App-Registrierung gibt**, läuft die Entwicklungsanmeldung:
eine Liste der angelegten Benutzer, aus der man einen auswählt. Sie prüft
nichts.

```
DMS_ANMELDUNG=entwicklung
DMS_SITZUNGS_GEHEIMNIS=…
```

Sie greift nur, wenn **beide** Bedingungen erfüllt sind: die Variable ist
gesetzt **und** `NODE_ENV` steht nicht auf `production`. Steht eine echte
Anmeldung bereit, gewinnt immer diese — auch wenn die Variable gesetzt bleibt.

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

---

## Texterkennung

Vor allem anderen muss Text da sein. Suche, Erkennung der Rechnungsdaten und
die selbsttätige Zuordnung arbeiten alle auf dem Seitentext — ein Beleg ohne
Text ist für das System ein Bild.

Die meisten PDFs bringen ihren Text mit. Ein **Scan** nicht: Er besteht aus
Pixeln. Das System stellt das selbst fest (im Schnitt weniger als 40 Zeichen
je Seite) und schickt ihn dann durch die Texterkennung.

**Eingeschaltet wird sie über `DMS_OCR=ocrmypdf`**, und zwar auf dem Rechner,
auf dem der *Worker* läuft — nicht auf dem der Anwendung. Vorausgesetzt sind
dort drei Dinge: Python mit ocrmypdf, Tesseract mit deutschem Sprachpaket und
Ghostscript.

| Variable | Vorgabe | Wofür |
|---|---|---|
| `DMS_OCR` | `keine` | `ocrmypdf` schaltet ein |
| `DMS_OCR_SPRACHE` | `deu` | Mehrere mit `+`, etwa `deu+eng` |
| `DMS_OCR_ZEITLIMIT_S` | `300` | Abbruch je Beleg |
| `DMS_OCR_PROGRAMM` | `ocrmypdf` | Falls es nicht im Pfad liegt |

**Ohne eingerichtete Erkennung geht kein Scan verloren — er wird sichtbar.**
Der Beleg landet im [Fehlerkorb](#fehlerkorb) mit dem Grund, dass keine
Erkennung eingerichtet ist. Von dort führen die üblichen Wege weiter, in der
Regel *von Hand*.

Das ist der eigentliche Gewinn. Vorher lief so ein Beleg einfach durch: Status
*laufend*, Seiten ohne Text, keine Suche, keine erkannten Felder — und niemand
erfuhr davon. Wer den Worker startet, sieht jetzt außerdem gleich in der ersten
Zeile, ob Erkennung da ist.

**Das Original wird nicht angetastet.** Die erkannte Fassung liegt als
*PDF/A-Derivat* daneben; angezeigt und archiviert wird weiter die Datei, die
hereinkam. Nebenbei entsteht damit das PDF/A aus der Aufbewahrung — allerdings
nur für Belege, die durch die Erkennung gingen.

**Begradigt und gedreht wird nicht**, so verlockend es bei schiefen Scans
wäre: Beides änderte die Seitengeometrie, und die Vorschaubilder entstehen aus
dem Original. Vorschau und PDF lägen dann nicht mehr übereinander.

> Noch nicht da: Kommen viele Scans herein, während keine Erkennung
> eingerichtet ist, füllt sich der Fehlerkorb mit einem Eintrag je Beleg. Sie
> lassen sich danach nur einzeln wiederholen — eine Sammelaktion fehlt.

---

## Wie Belege sich selbst zuordnen

Im Bestand pflegt jemand die Zuordnungsregeln von Hand. Hier entstehen sie aus
bestätigten Zuordnungen: Kundennummern, Zählernummern und Vertragsnummern muss
niemand eintragen — das System merkt sie sich, wenn ein Mensch einmal bestätigt
hat, wohin ein Beleg gehört.

**Deterministische Merkmale schlagen alles.** Steht eine bekannte Kundennummer
im Beleg, ist die Zuordnung eindeutig — auch wenn derselbe Lieferant für
zwanzig Objekte tätig ist. Der Lieferant allein sagt nichts, die Kundennummer
alles.

**Mehrere Kandidaten sind schlechter als keiner.** Deuten die Merkmale eines
Belegs auf zwei Objekte, wird das **rot**, nicht orange. Ein Beleg, der zu zwei
Objekten passt, gehört angesehen.

**Korrigieren heißt umlernen.** Ordnet jemand einen Beleg anders zu, wird die
alte Regel deaktiviert und eine neue geschrieben — nicht überschrieben. Die
alte erklärt später, warum ein Beleg damals anders zugeordnet wurde. Ein
Nachlauf bewertet danach die noch offenen Belege neu; abgeschlossene bleiben
unberührt.

**Nichts wird über die Mandantengrenze gelernt.** Auch nicht „anonymisiert".

Gesucht wird nach Nummern ab vier Zeichen und nach IBANs. Kürzere Folgen — eine
Hausnummer, ein Steuersatz — würden zufällig treffen, und ein falsch
zugeordneter Beleg kostet mehr Zeit, als die Zuordnung spart.

> Noch nicht gebaut: die Ähnlichkeitssuche über Positionstexte, damit die
> Hausmeisterrechnung wieder in Reinigung, Gartenpflege und Winterdienst
> zerfällt. Die Tabelle dafür steht; sie arbeitet vorerst über den exakten
> Text. Laut Konzept darf Ähnlichkeit ohnehin nie besser als orange ausfallen.


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

## Anmelden und abmelden

Die Anmeldung läuft über das Geschäftskonto bei Microsoft. **Das DMS kennt
kein eigenes Passwort** — es gibt nichts zurückzusetzen und nichts zu
verwalten. Wer im Unternehmen gesperrt wird, ist damit auch im DMS gesperrt,
ohne dass jemand daran denken muss.

*Abmelden* steht oben rechts auf jeder Seite. Es beendet die Sitzung
tatsächlich, nicht nur im Browser: Der Eintrag in der Datenbank wird
geschlossen, ein mitgeschnittenes Cookie nützt danach nichts mehr.

> Noch nicht da: Die Abmeldung beendet nur die DMS-Sitzung. Die
> Microsoft-Sitzung im Browser bleibt bestehen — auf einem gemeinsam
> genutzten Rechner ist das ein Unterschied.

### Eine Sitzung endet auch von selbst

| Grund | Wann |
|---|---|
| Untätigkeit | nach 8 Stunden ohne Aufruf |
| Ablauf | 12 Stunden nach der Anmeldung, unabhängig von der Nutzung |
| Sperrung | sofort, sobald der Benutzer auf inaktiv gesetzt wird |
| Widerruf | wenn jemand alle Sitzungen eines Benutzers beendet |

Der dritte Punkt ist der Grund für die ganze Bauart: Die Sitzung steht in der
Datenbank und wird bei **jedem** Aufruf nachgeschlagen. Ein selbsttragendes
Token im Cookie wäre schneller, würde aber bis zum Ablauf weitergelten — ein
gesperrter Mitarbeiter arbeitete bis zu zwölf Stunden weiter.

### „Zu diesem Konto gibt es keinen Zugang"

Diese Meldung heißt: Die Anmeldung bei Microsoft hat geklappt, aber im DMS
ist kein Benutzer angelegt.

**Das ist kein Fehler, sondern die Regel.** Wer im DMS arbeiten darf,
entscheidet die Verwaltung — nicht Microsoft. Andernfalls hätte jeder im
Unternehmen mit dem ersten Anmeldeversuch Zugriff auf Rechnungen, und die
Rechtevergabe liefe der Anmeldung hinterher.

Ein neuer Kollege wird also erst angelegt, dann meldet er sich an. Beim ersten
Mal wird sein Microsoft-Konto über die E-Mail-Adresse mit dem Benutzer
verknüpft; danach gilt die Verknüpfung, nicht mehr die Adresse. Ein
Namenswechsel kostet deshalb keinen Zugang.

> Noch nicht da: eine Benutzerverwaltung in der Oberfläche. Benutzer werden
> derzeit in der Datenbank angelegt.

---

## Posteingang

Unter *Posteingang* kommen Belege ins System. Zwei Wege, und welcher es ist,
entscheidet ein Mensch — nicht eine Erkennung:

**Einzelner Beleg.** Datei wählen, aufnehmen, fertig. Der Beleg geht sofort in
den Ablauf.

**Stapelscan.** Aus dem Scanner kommt eine Datei mit zwanzig Belegen. Sie wird
zuerst gelesen, gerendert und getrennt — und erst nach Ihrer Bestätigung
entstehen daraus Dokumente.

### Warum der Umweg

Bis zur Übernahme ist **nichts geschrieben**, was zurückgenommen werden
müsste. Würde die Scandatei erst ein Beleg und danach zerlegt, hätte sie einen
Prüfwert über zwanzig Belege, Seiten in der Belegtabelle und womöglich schon
einen laufenden Ablauf. Beim Zerlegen müsste all das rückgängig gemacht
werden — und der Prüfwert des ersten Belegs wäre nie der Prüfwert der Datei,
die tatsächlich eingegangen ist.

Deshalb ist ein Stapel **kein Beleg**. Erst beim Übernehmen bekommt jeder
Beleg seine eigene PDF-Datei und seinen eigenen Prüfwert.

### Trennung und Korrektur

Erkannt wird ein **Trennblatt**: eine fast leere Seite, auf der „Trennblatt",
„Trennseite" oder „Separator" steht. Das Wort mitten in einer langen Rechnung
zählt nicht — eine Druckereirechnung kann Trennblätter als Position führen.

Die Korrekturansicht zeigt alle Seiten als Miniaturen, nach Beleg gruppiert.
An jeder Seite steht *hier trennen* beziehungsweise *Trennung aufheben*; jede
Änderung nummeriert die Belege neu. **Diese Ansicht ist kein Zugeständnis an
eine schwache Erkennung, sondern Teil des Entwurfs** — keine automatische
Trennung ist fehlerfrei, und ein falsch getrennter Stapel erzeugt zwanzig
falsche Belege auf einmal.

Was von Hand geändert wurde, ist als solches vermerkt. Der Unterschied ist die
Grundlage für die Frage, wie gut die Erkennung tatsächlich ist.

### Zwischen Hochladen und Prüfen

Ein Stapel steht kurz auf *Aufbereitung*: Seiten lesen und rendern übernimmt
der Worker, nicht die Weboberfläche. Bei dreißig Seiten wäre das nichts für
einen Klick, der auf eine Antwort wartet. Die Prüfansicht sagt es und bittet
um erneutes Laden.

> Noch nicht da: **Barcode-Trennblätter** werden über ihre Klarschriftzeile
> erkannt, nicht über den Barcode selbst. Ein Blatt, das nur einen Barcode
> trägt, muss von Hand getrennt werden.

---

## Belege, die von selbst hereinkommen

Upload und Scan beginnen bei einem Menschen. Zwei weitere Wege laufen ohne
Zutun, im Worker: ein **überwachter Ordner** und ein **Mailpostfach**. Was sie
finden, geht durch denselben Eingang wie ein Upload — dieselbe
Dublettenprüfung, dieselbe Aufbereitung, dieselbe Warteschlange. Eine Quelle
liefert Dateien, sonst nichts.

Unter *Eingangsquellen* steht, was eingerichtet ist und ob es läuft.

### Was eine Quelle mitbringt

Jede Quelle kann Objekt, Ordnungsgruppe und Belegart vorbelegen. Ein Ordner je
Objekt oder ein Postfach nur für Handwerkerrechnungen erspart damit die
Zuordnung von Hand.

Der **Takt** steht an der Quelle: Ein Ordner darf häufiger abgefragt werden
als ein Postfach — der eine kostet einen Verzeichniseintrag, das andere eine
Anmeldung.

### Überwachter Ordner

Der Weg, über den in der Praxis ein Netzwerkscanner oder ein FTP-Server
ablegt. Aufgenommen werden PDF, XML und `.eml`; alles andere bleibt liegen.

**Eine Datei, die noch geschrieben wird, wird nicht angefasst.** Ein Scanner
öffnet sie und füllt sie über Sekunden; wer sofort liest, bekommt ein halbes
PDF — und das System meldete einen kaputten Beleg, der in Ordnung war. Erst
nach zehn Sekunden ohne Änderung gilt eine Datei als fertig (einstellbar).

**Verschoben wird nach dem Aufnehmen, nie davor** — sonst ist die Datei weg,
wenn die Aufnahme scheitert. Ohne eingestellten Zielordner bleibt sie ganz
liegen; ein Programm, das ungefragt in fremden Ordnern aufräumt, macht mehr
kaputt als es hilft. Dass sie trotzdem nicht zweimal hereinkommt, trägt die
Merkliste.

### Mailpostfach

Abgeholt wird über IMAP. **Jeder Rechnungsanhang wird ein eigener Beleg** —
eine Mail mit drei Rechnungen ergibt drei. Signaturbilder und Briefköpfe
werden übergangen, sonst entstünde aus jeder Kanzleimail ein Dutzend Belege
aus Grafiken.

**Eine Mail ohne verwertbaren Anhang wird selbst zum Beleg**, als
Schriftverkehr. Sie zu überspringen wäre der schlechteste Ausgang: Der
Absender hat geschrieben, im DMS stünde nichts, und niemand erführe davon.
Betreff, Absender und Text sind durchsuchbar; eine Seitenvorschau gibt es
nicht.

**Nichts wird gelöscht und nichts verschoben.** Die Merkliste trägt, dass
keine Nachricht zweimal hereinkommt. Wer möchte, lässt gelesene Nachrichten
als gelesen markieren — mehr nicht.

### Das Passwort steht nicht in der Datenbank

In der Quelle steht der **Name** einer Umgebungsvariablen, nicht das Passwort.
Das Geheimnis liegt auf dem Rechner, auf dem der Worker läuft. Ein
Datenbankauszug gibt damit keinen Postfachzugang her, und wer eine Quelle
einrichtet, sieht nie ein Passwort, das er weiterreichen könnte.

### Wer die Quelle trägt

Eine Quelle arbeitet unter den Rechten dessen, der sie eingerichtet hat. Das
ist zurechenbar — am Beleg steht ein Name, den man fragen kann — und es
begrenzt von selbst: Eine Quelle kann nichts anlegen, was ihr Einrichter nicht
auch von Hand anlegen könnte.

Scheidet die Person aus und wird ihr Zugang gesperrt, **steht die Quelle
still**. Das ist gewollt: Sie steht dann sichtbar still, statt unter dem Namen
eines Ausgeschiedenen weiterzulaufen.

### Wenn etwas nicht mehr läuft

Niemand sieht zu. Deshalb stehen unter *Eingangsquellen* zwei Zeitpunkte
nebeneinander: *nachgesehen* und *zuletzt etwas bekommen*. Der Unterschied ist
die Auskunft — eine Quelle, die läuft und nichts findet, ist etwas anderes als
eine, die gar nicht mehr läuft.

Ein Fehler steht an der Quelle, nicht im Log: Ein falscher Pfad, ein
abgelaufenes Passwort. Und er hält die anderen Quellen nicht auf.

> Noch nicht da: die **Maske zum Einrichten** — Quellen werden derzeit in der
> Datenbank angelegt. Der IMAP-Teil ist außerdem **nicht gegen einen echten
> Mailserver geprüft**; getestet ist alles danach: was aus einer Nachricht
> wird, die Merkliste, der Durchgang, die Fehlerbehandlung.



---

## Fehlerkorb

Die Aufbereitung — lesen, rendern, Text gewinnen, Felder erkennen — läuft im
Hintergrund und kann scheitern. Dreimal versucht es das System von selbst,
dann gibt es auf. Was dann?

**Zuerst: Der Beleg ist nicht verloren.** Sein Ablauf startet beim *Eingang*,
nicht nach der Aufbereitung. Die Aufgabe liegt also im Postfach, und jemand
kann sie bearbeiten. Was fehlt, sind Vorschau, Seitentext und erkannte Felder.
Der Beleg ist unvollständig, nicht weg.

Genau deshalb gibt es die Seite *Fehlerkorb*: Ohne sie öffnete jemand einen
leeren Beleg und wüsste nicht, warum er leer ist.

### Zwei Listen

**Aufgegeben** — die Warteschlange hat aufgehört und den Grund hinterlassen.
Dort steht, was schiefging (`ocrmypdf: exit 2`), aus welcher Warteschlange es
kam und wie oft versucht wurde.

**Hängt** — seit mehr als einer halben Stunde in Aufbereitung, ohne dass
überhaupt etwas gemeldet wurde. Der häufigste Grund ist ein Worker, der
zwischendurch beendet wurde: Dann gibt es keinen Auftrag mehr, der scheitern
könnte, und ohne diese zweite Liste bliebe der Beleg für immer liegen.

Die zweite Liste fragt nicht die Warteschlange, sondern den Zustand. Sie ist
deshalb auch dann richtig, wenn an der Warteschlange etwas kaputt ist.

### Die drei Ausgänge

| Ausgang | Wann | Was passiert |
|---|---|---|
| **wiederholen** | Die Ursache war vorübergehend — Platte voll, Dienst weg | Zurück in die Warteschlange |
| **von Hand** | Die Aufbereitung wird nicht mehr versucht | Der Beleg wird `laufend`, die Felder werden von Hand erfasst |
| **verwerfen** | Die Datei ist nicht zu gebrauchen | **Storno** mit Begründung — kein Löschen |

„Von Hand" ist keine Notlösung, sondern die Regel des Konzepts: Fällt die
Erkennung aus, läuft der Ablauf trotzdem und jemand tippt die Daten ein. Für
einen **Stapel** gibt es diesen Ausgang nicht — vor der Übernahme ist er noch
kein Beleg, an dem sich arbeiten ließe.

**Verworfen heißt storniert, nicht gelöscht.** Der Beleg hat existiert, das
bleibt sichtbar, und der Grund steht am Ablauf. Kommt die Datei später lesbar
herein, ist das ein neues Dokument.

Ein „erledigt"-Haken, der nur den Eintrag wegnimmt, ist bewusst nicht dabei:
Er hätte den Korb geleert und das Problem stehen lassen.

> Noch nicht da: eine **Benachrichtigung**, wenn etwas in den Korb fällt
> (Konzept 24, Punkt 9 — Mail oder nur ein Zähler in der Oberfläche, das ist
> noch nicht entschieden). Bis dahin sieht man in den Korb, indem man
> hinschaut.

---

## Belege finden

Unter *Belege* steht die Übersicht. Sie ist der Weg zu jedem Beleg, der
**nicht** gerade als Aufgabe im Postfach liegt — also zu allen abgeschlossenen
und archivierten.

**Ohne Filter** zeigt sie das Neueste aus Ihren Objekten. **Sobald ein Filter
gesetzt ist**, wird gesucht: nach Objekt, Ordnungsgruppe, Belegart, Ampel,
Eingangszeitraum und Volltext. Der Unterschied ist nicht nur die Anzeige — es
sind zwei verschiedene Abfragen, und die zweite ist die teurere. Wer nach
„alle roten Ampeln" fragt, will alle, nicht die neuesten je Objekt.

Ordnungsgruppe und Spezialgebiet erscheinen als farbige Marken. Die Farbe
kommt aus den Stammdaten — eine neue Ordnungsgruppe bringt ihre Marke mit,
ohne dass jemand die Oberfläche anfasst.

### Volltext

Gesucht wird im Seitentext, mit deutscher Stammformreduktion:
*Dachrinnenreinigungen* findet *Dachrinnenreinigung*. Das Suchfeld versteht,
was Menschen von Suchfeldern erwarten:

| Eingabe | Bedeutung |
|---|---|
| `dachrinne hof` | beide Wörter |
| `"Hof Nordseite"` | genau diese Wortfolge |
| `dachrinne -hof` | *dachrinne*, aber nicht *hof* |

Unsinnige Eingaben führen nicht zu einem Fehler, sondern zu keinem Treffer.

Zu jedem Volltexttreffer steht die **Seite** und ein Auszug mit der Fundstelle.

> Die Auszeichnung im Auszug wird als Text angezeigt, nicht als Formatierung:
> Der Auszug stammt aus einem Belegtext, und der ist keine vertrauenswürdige
> Quelle.

### Was Sie sehen und was nicht

Die Liste zeigt ausschließlich, was Sie ohnehin sehen dürfen — **auch die
Trefferzahl**. Sonst verriete allein die Zahl, dass da etwas ist.

- Belege Ihrer Objekte: über die Objektzuständigkeit oder eine Rolle mit dem
  Recht *ansehen*.
- Belege eines Spezialgebiets: über die Spezialgebietszuständigkeit. Diese
  öffnen den einzelnen Beleg, **nicht** die Akte des Objekts — der Feed zeigt
  sie deshalb nicht, die Suche schon.
- Eingeschränkte Belege: in keiner Sicht, für niemanden.

---

## Kontieren

Steht ein Beleg an einer Kontierungsstufe, erscheint die Kontierung auf dem
Aufgabenbildschirm — unter den Prüfhinweisen, über dem Beleg.

> **Der mitgelieferte Ablauf** führt eine Rechnung über fünf Stufen:
> sachliche Prüfung (Objektverantwortliche), rechnerische Prüfung
> (Buchhaltung), Freigabe (Geschäftsleitung), Kontierung (Buchhaltung),
> Zahlungsübergabe (Buchhaltung). Die letzten beiden fehlten anfangs — der
> Ablauf endete vor der Kontierung, und damit waren *beide* Masken im
> Betrieb unerreichbar, obwohl sie fertig sind. Aufgefallen ist es erst, als
> ein Test die Zahlungsansicht öffnen wollte und sie nicht fand.

Eine Rechnung zerfällt in Zeilen: **Konto, Steuersatz, Betrag**. Der Betrag
ist der **Bruttobetrag**, so wie er auf dem Beleg steht; netto rechnet das
System. Eine Rechnung, die auf ein einziges Konto geht, braucht kein
Abtippen — die Schaltfläche **Rest übernehmen** legt eine Zeile über genau
den noch offenen Betrag an. Das ist kein Komfort: Abtippen ist die Stelle,
an der Zahlendreher entstehen.

Zur Auswahl stehen nur die Konten des **Kontenrahmens, der am Objekt hängt**.
Ein Konto eines anderen Rahmens lässt sich nicht wählen, auch nicht über den
Umweg eines Formulars.

**Umlagefähigkeit und Umlageschlüssel gehören zur Zeile, nicht zum Beleg.**
Beide kommen als Vorschlag aus dem Konto und lassen sich überschreiben: der
Umlageschlüssel beim Anlegen der Zeile, die Umlagefähigkeit danach durch
Klick auf den Eintrag in der Spalte *Umlage*. Steht dort *ohne Schlüssel*,
ist die Zeile zwar umlagefähig, aber noch nicht verteilbar — dann Zeile
entfernen und mit Schlüssel neu anlegen.

### Der Summenzwang

**Die Summe der Zeilen muss den Rechnungsbetrag ergeben.** Solange sie das
nicht tut, zeigt die Tabelle *Offen* in Rot, und die Stufe lässt sich nicht
freigeben — der Stempel wird mit Begründung abgewiesen. Das ist eine harte
Sperre, keine Ampelfarbe.

Was weiterhin geht: **zur Klärung geben**. Wer nicht kontieren kann, weil
etwas unklar ist, muss den Beleg abgeben können; bereits gesetzte Stempel
bleiben gültig, die Stufe wird gemerkt.

Geprüft wird über die Kontierung, **nicht** über die Zahlungszeilen. Sonst
würde der Eigenanteil bei einer Selbstbeteiligung die Prüfung verletzen,
obwohl die Kontierung stimmt.

> Noch nicht da: ein Vorschlag aus dem Lernspeicher. Die Tabelle
> `kontierungs_muster` steht, aber es gibt noch keine Rechnungspositionen,
> aus denen sich ein Positionstext lesen ließe. Ebenso fehlen die Angaben
> nach § 35a EStG in der Maske — das Schema trägt sie, die Erfassung nicht.

---

## Zahlen

**Der Zahlungsweg ist ein Stammdatum am Objekt, keine Entscheidung im Beleg.**
Der Ablauf ist überall derselbe — geprüft, freigegeben, übergeben,
archiviert —, nur das Ziel unterscheidet sich. Ein dritter Weg wird in den
Einstellungen angelegt und am Objekt hinterlegt; im Code ändert sich nichts.

Der Stempel an der Bankübergabe ist deshalb **keine Bestätigung, sondern eine
Handlung**: Er weist Geld an. Vorher steht auf dem Bildschirm, was passieren
wird — Weg, Empfänger, Betrag, Fälligkeit. Die IBAN wird auf die letzten vier
Stellen gekürzt; zum Wiedererkennen genügt das.

**Lastschrift ist kein Weg**, sondern eine Eigenschaft des Kreditors oder des
Vertrags: Es wird nichts übergeben, nur die Fälligkeit vermerkt. Was auf dem
Beleg steht, gilt vor dem Vertrag — eine einmalige Rechnung eines Lieferanten
mit Lastschriftvertrag kann trotzdem zu überweisen sein.

Bei **Selbstbeteiligung** bleibt der Beleg einer und die Zahlung wird zweimal
ausgelöst: `voll` im regulären Durchlauf, `eigenanteil` nach Rückkehr aus dem
Versicherungslauf. Deshalb prüft der Summenzwang gegen die Kontierung und
nicht gegen die Zahlungszeilen — sonst würde genau dieser Fall ihn verletzen.

### Die harte Sperre

Vor der Übergabe wird geprüft, und zwar in dieser Reihenfolge. Die erste
Antwort ist die, die auf dem Bildschirm steht:

| Nr. | Geprüft wird |
|---|---|
| 1 | Sind alle Freigaben noch **gültig**? |
| 2 | Ist jede Pflichtstufe durch? |
| 3 | Ergibt die Kontierung den Rechnungsbetrag? |
| 4 | Steht ein harter Prüfhinweis offen (IBAN, Dublette)? |
| 5 | Ist am Objekt ein aktiver Zahlungsweg hinterlegt? |
| 6 | Gibt es eine verifizierte Bankverbindung, wenn der Weg sie verlangt? |

**Punkt 1 ist der wichtigste und der unauffälligste.** Ein gesetzter Stempel
ist nicht dasselbe wie ein gültiger. Wird nach der Freigabe der Betrag
korrigiert oder der Beleg einem anderen Objekt zugeordnet, galt die Freigabe
einer anderen Rechnung. Solche Belege sehen in keiner Liste verdächtig aus.

Das System lässt die betroffenen Freigaben dann **sichtbar verfallen**: Je
Stufe wird ein Eintrag geschrieben, die Aufgabe geht wieder auf, und der Beleg
springt auf die früheste betroffene Stufe zurück. Ein stiller Rücksprung wäre
schlimmer als gar keiner — niemand könnte erklären, warum der Beleg wieder da
ist.

Die Bankdaten werden **vor** der Wegewahl geprüft: Unvollständige Daten führen
zur Sperre, nicht zu einer fehlgeschlagenen Übergabe.

> Noch nicht da: der **Mailversand**. Damit ist scan2bank — der Weg aus dem
> Bestand — derzeit nicht benutzbar; der Bildschirm sagt es vor dem Stempeln.
> Das ist Absicht: Eine als übergeben vermerkte Zahlung, die nie jemanden
> erreicht hat, lässt den Beleg aus allen Listen verschwinden, und das Geld
> fließt nie. Dateiexport und die Übergabe an ein Fremdsystem laufen.

> Ebenfalls offen: das Feld *Rückmeldung* bleibt leer. Endet die Verantwortung
> mit der Übergabe, ist es ungenutzt; kommt später ein Kontoauszugsabgleich,
> ist der Platz da.

---

## Warten auf jemand anderen

Manche Belege sind im Haus fertig und trotzdem nicht abgeschlossen: Es fehlt
eine Erstattung der Versicherung, eine Zahlungsbestätigung, eine Antwort auf
eine Gewährleistungsrüge. Für sie gibt es den **Wartecontainer** — den Zustand
„wir haben alles getan und warten auf jemand anderen".

Eröffnet wird er am Beleg, gesehen wird er unter *Warten*. Ohne ihn wäre ein
solcher Beleg entweder eine offene Aufgabe, die niemand bearbeiten kann, oder
gar nichts.

**Die Wiedervorlage ist Pflicht und muss in der Zukunft liegen.** Das ist der
ganze Zweck: Ein Wartecontainer ohne Frist wäre ein Ort, an dem Belege
verschwinden. Die Liste ist nach Fälligkeit sortiert und hebt Überfälliges
hervor.

Geschlossen wird nur **mit Ergebnis** — „Erstattung eingegangen, 890,00 EUR".
Ein Container, der ohne Ergebnis endet, hinterlässt die Frage, warum nicht
mehr gewartet wird.

Ein Beleg kann auf **mehreres gleichzeitig** warten. Der Ablauf läuft erst
weiter, wenn der letzte Container geschlossen ist.

### Bauteile und Gewährleistung

Bei einer Erneuerung wird das neue Bauteil mit Einbaudatum und
Gewährleistungsfrist erfasst; das alte wird stillgelegt und verkettet, nicht
gelöscht. Ohne die Kette wäre nach der zweiten Erneuerung nicht mehr zu sagen,
wie alt die Anlage ist.

Kommt später eine Reparaturrechnung, **weist der Beleg darauf hin**, dass am
Objekt noch Bauteile unter Gewährleistung stehen — mit Frist und Lieferant.
Aus der bisherigen Mailmeldung wird damit eine auswertbare Historie: Das
System schlägt vor, statt dass jemand nachsehen muss.

Gefragt wird zu einem **Stichtag**, nicht zum heutigen Tag: Die Frage lautet
„war zum Schadenszeitpunkt Gewährleistung offen", und zwischen Schaden und
Rechnung vergehen Wochen.

> **Was hier bewusst nicht steht:** die Versicherungs- und Technikabläufe
> selbst. „Nebenläufe sind keine Sonderprogramme, sondern Prozessdefinitionen
> mit eigenem Einstieg" — Selbstzahlung gegen Abtretung, Wartung gegen
> Reparatur gegen Erneuerung sind Stufen und Bedingungen unter *Abläufe*. Wer
> sie im Code sucht, sucht falsch.

> Noch nicht da: die **Systemaktionen** aus den Diagrammen — die Mail mit der
> Abtretungserklärung, die Erfassungsmeldung an die Technik-Datenbank. Der
> Weg nach draußen steht inzwischen (Postausgang), und die Vorlagen
> `abtretung` und `technikmeldung` liegen im Grundbestand; was fehlt, ist die
> Stelle im Ablauf, die sie auslöst. Und die Fristüberschreitung führt noch
> nicht selbsttätig ins Klärungspostfach; die Liste zeigt sie, den Eintrag
> setzt ein Mensch.

---

## Stempel, Notizen und Schwärzungen

Alles, was am Beleg angebracht wird, liegt **neben** dem PDF — nie darin. Vier
Dinge folgen daraus, und alle vier sind der Grund für die Bauart:

* Das **Original bleibt bitgenau**. Sein Hash im Archiv gilt weiter, auch
  nachdem vier Menschen gestempelt und zwei kommentiert haben.
* Anmerkungen sind **durchsuchbar** wie der Belegtext.
* Die **Sichtbarkeit** ist je Eintrag steuerbar: Eine interne Notiz geht nie
  nach außen.
* Ein **Export** kann Layer wahlweise einbrennen oder weglassen.

Der Preis dafür: Wer das PDF herunterlädt, sieht nichts davon. Deshalb liefert
die externe Einsicht nie das Original, sondern Seitenbilder — mit allem, was
draufgehört, fest eingebrannt.

### Stempel

**Ein Stempel entsteht aus seinem Ereignis, nicht von Hand.** Wer stempelt,
löst beides zugleich aus: den Eintrag im Protokoll und das Bild auf dem Beleg.
Es gibt keinen Weg, das eine ohne das andere zu bekommen — sonst gäbe es
Stempel, die im Protokoll fehlen, oder Entscheidungen, die man am Beleg nicht
sieht.

**Wohin er kommt, rechnet das System beim Eingang aus.** Aus den Fundstellen
des Textes ergeben sich die freien Flächen; der Stempel bekommt die erste
davon, bevorzugt rechts oben, dann rechts unten. **Kein Stempel überdeckt
Text.** Das ist keine Kosmetik: Ein Stempel über dem Rechnungsbetrag macht aus
einer Prüfung eine Behauptung, und weil das Original unverändert bleibt, fiele
es erst beim Export auf.

Ist die Seite voll, wird der Stempel gemerkt und gehört auf eine angehängte
Leerseite. Verloren geht er nie.

**Verfällt eine Freigabe** (weil sich die Rechnungsdaten geändert haben),
verschwindet ihr Stempel vom Beleg. Das Ereignis bleibt im Protokoll — der
Beleg soll zeigen, was *gilt*, das Protokoll, was *geschehen ist*.

### Notizen und Hervorhebungen

Anzulegen in der Belegansicht. Angaben in PDF-Punkten, Ursprung oben links;
eine A4-Seite ist 595 × 842. Das ist umständlich, und es ist ehrlich: Zum
Aufziehen mit der Maus bräuchte es Bedienlogik im Browser, die es hier sonst
nirgends gibt.

**Vorgabe ist intern.** Eine Notiz geht nur nach draußen, wenn das ausdrücklich
angehakt wird — die sichere Richtung, nicht die bequeme.

**Gelöscht wird nichts, nur ausgeblendet.** Eine Notiz, die spurlos
verschwindet, macht den Beleg unerklärbar. Und der Text lässt sich nachträglich
nicht ändern: Wer das könnte, könnte eine fremde Einschätzung umschreiben.

### Schwärzungen

Eine Schwärzung ist **immer auch nach außen sichtbar**. Sie auf „intern" zu
stellen hieße, dass sie draußen fehlt — und damit das Verdeckte erscheint.
Deshalb lässt sich das nicht einstellen.

**Ein geschwärzter Beleg geht extern nur noch als Seitenansicht hinaus, nicht
mehr als PDF.** Der Grund gehört dazugesagt:

> Ein schwarzes Rechteck in einem PDF liegt nur *darauf*. Der Text darunter
> bleibt im Dokument und lässt sich markieren, kopieren oder mit jedem
> Werkzeug auslesen. Genau so sind schon Behörden und Kanzleien aufgefallen.
> Richtig zu schwärzen hieße, den Seiteninhalt neu zu schreiben — das leistet
> die verwendete PDF-Bibliothek nicht, und eine halbe Lösung wäre hier
> schlimmer als keine: Sie *sähe aus* wie eine Schwärzung.

Im Seitenbild ist die Schwärzung dagegen echt — ein Bild hat keinen Text, was
übermalt ist, ist weg. Wer den Download braucht, muss die Schwärzung
ausblenden; dann steht der PDF-Download wieder zur Verfügung.

Sind die Seitenmaße eines Belegs nicht erfasst — Altbestand, abgebrochene
Aufbereitung —, lässt sich nichts umrechnen. Dann geht ein geschwärzter Beleg
**gar nicht** hinaus; Notizen und Hervorhebungen entfallen still.

### Den Beleg ausgeben

Unter der Belegansicht stehen vier Wege hinaus. Welchen man nimmt, hängt
daran, wer den Beleg bekommt.

| Ausgabe | Was drauf ist | Wofür |
|---|---|---|
| **Original-PDF** | nichts | Archiv, Prüfung, alles, wo der Hash zählen muss |
| **Beleg mit Stempeln** | Stempel | die eigene Ablage, der Steuerberater |
| **Belegeinsicht** | Stempel, Schwärzungen, freigegebene Hervorhebungen, Wasserzeichen | Eigentümer, Beirat, Mieter |
| **Interne Akte** | alles, auch Notizen | der eigene Gebrauch |

**Das Original bleibt Byte für Byte, was es war.** Es wird nicht neu
geschrieben, bekommt kein Wasserzeichen und keine Stempel — sonst stimmte der
Hash im Archiv nicht mehr, und dann ist das Archiv eine Behauptung.

**Stempel, die auf der Seite keinen Platz fanden**, bekommen im Export eine
angehängte Leerseite. Ein Stempel darf nicht verschwinden, nur weil das Blatt
voll war.

**Eine interne Notiz geht nie in die Belegeinsicht** — auch dann nicht, wenn
jemand sie ausdrücklich freigegeben hat. Diese Variante zeigt überhaupt keine
Notizen.

#### Geschwärzte Belege

Ist ein Beleg geschwärzt, entstehen **alle** Ausgaben außer dem Original aus
den Seitenbildern statt aus dem PDF. Das ist der wichtige Teil, und der Grund
gehört dazugesagt:

> Ein schwarzes Rechteck in einem PDF liegt nur *darauf*. Der Text darunter
> bleibt im Dokument und lässt sich markieren, kopieren oder mit jedem
> Werkzeug auslesen. Genau so sind schon Behörden und Kanzleien aufgefallen.

Ein Bild hat keinen Textlayer — was übermalt ist, ist weg. Der Preis: Das
ausgegebene PDF ist nicht mehr durchsuchbar. Für etwas, das aus dem Haus geht,
ist das der richtige Tausch; das durchsuchbare Original bleibt im Archiv.

Die Regel gilt **auch für „Beleg mit Stempeln"**, obwohl diese Variante
Schwärzungen gar nicht zeigt. Sonst gäbe es einen Weg zu einem PDF, in dem das
Geschwärzte im Klartext steht — einen Klick entfernt.

Fehlen die Seitenbilder (Altbestand, abgebrochene Aufbereitung), gibt es bei
einem geschwärzten Beleg **gar keine** Ausgabe außer dem Original. Lieber
keine als eine, die nur aussieht wie geschwärzt.

#### In der Objektakte

Die Akte für den Verwalterwechsel enthält zu jedem Beleg beides: `<id>.pdf`
mit dem Original und `<id>-gestempelt.pdf` mit den Freigaben darauf. Vorher
bekam ein Nachfolgeverwalter nur das rohe Original — ein Blatt, dem man nicht
ansieht, dass es je geprüft wurde. Beide stehen im Manifest, beide lassen sich
ohne uns prüfen.

Fehlt zu einem Beleg die Lesefassung, steht er im Kopf des Manifests. Eine
Akte mit einer stillen Lücke ist schlimmer als eine mit einer bekannten.



---

## Belegeinsicht nach außen geben

Eigentümer, Beirat und Mieter bekommen **keinen Benutzer**, sondern einen
befristeten Link. Unter *Einsicht* wird er angelegt.

**Der Link wird genau einmal angezeigt.** Danach steht in der Datenbank nur
seine Prüfsumme. Wer ihn verliert, legt einen neuen Zugang an und widerruft
den alten — das ist unbequem und genau der Grund, warum ein Datenbankauszug
keinen Zugang öffnet.

### Was der Empfänger sieht

| Empfänger | Auswahl |
|---|---|
| **Mieter** | Belege mit umlagefähigen Kosten aus **seiner Mietzeit** — berechnet |
| **Eigentümer / Beirat** | ein Wirtschaftsjahr oder ein Vorgang |

Die Mieterauswahl ist der wichtige Fall: Sie wird **gerechnet, nicht
freigegeben**. Es gibt keine Liste freigegebener Belege, die jemand pflegen
müsste. Wird eine Kontierungszeile nicht mehr als umlagefähig geführt, ist der
Beleg für den Mieter weg — ohne dass jemand den Zugang anfasst. Eine manuelle
Freigabe würde den Mieterwechsel übersehen: Wer im März auszieht, darf die
Aprilrechnung nicht sehen, auch wenn sie im Januar freigegeben wurde.

Nie enthalten: eingeschränkte und stornierte Belege. Was im Haus niemand mehr
sehen darf, darf erst recht nicht hinaus.

### Der Ablauf ist hart

Nach dem letzten Gültigkeitstag liefert der Link nichts mehr — auch dann
nicht, wenn er weitergereicht wurde. **Benutzung verlängert nicht.** Der
Widerruf wirkt sofort, nicht erst beim nächsten Aufräumlauf.

Für Mieter sind sieben Tage der übliche Zuschnitt. Erlaubt sind 1 bis 365.

### Wasserzeichen und Download

Jede angezeigte Seite trägt Name und Datum des Empfängers, quer über die
Fläche gekachelt. Das **verhindert nichts** — wer die Seite abfotografiert,
hat sie. Es macht eine weitergereichte Aufnahme aber zuordenbar, und das
ändert die Rechnung für den, der sie weitergibt. Der Beleg bleibt dabei
lesbar; ein Wasserzeichen, das die Zahlen verdeckt, führt nur dazu, dass
jemand stattdessen eine Kopie per Mail schickt.

**Download ist eine eigene Entscheidung** und standardmäßig aus. Ein
heruntergeladenes Original trägt kein Wasserzeichen und lässt sich nicht mehr
widerrufen.

### Das Protokoll

Jeder Aufruf wird festgehalten — auch der abgelehnte Versuch, und der ist der
interessantere Eintrag: Jemand hat eine Belegkennung ausprobiert, die nicht zu
seinem Zugang gehört.

Das Protokoll ist **nachträglich nicht änderbar**. Es ist zugleich der
Nachweis, dass Belegeinsicht gewährt wurde — ein Nachweis, den man wegräumen
kann, ist keiner.

> Zur IP-Adresse: Sie wird gespeichert, obwohl sie personenbezogen ist. Bei
> einem Zugang ohne Benutzerkonto ist sie das einzige Merkmal, an dem sich ein
> weitergereichter Link erkennen lässt. Eine eigene Aufbewahrungsfrist dafür
> ist noch offen.

**Den Link verschicken lassen.** Wer beim Anlegen eine Mailadresse einträgt,
bekommt den Link nicht nur angezeigt, sondern zusätzlich als Mail an den
Empfänger — über den [Postausgang](#postausgang). Bleibt das Feld leer, ändert
sich nichts am bisherigen Weg.

Der Ausgangseintrag ist dabei **flüchtig**: Sein Text enthält den Token, und
nach erfolgreichem Versand ersetzt ihn die Datenbank durch einen Vermerk. Sonst
läge ein gültiger Zugangslink im Klartext im Ausgangsbuch, so lange die
Gewährung läuft — und damit in jedem Datenbankauszug. Was der Zugang tat,
bleibt trotzdem nachvollziehbar: Empfänger, Umfang, Gültigkeit und Widerruf
stehen in der Gewährung, jeder Aufruf im Zugriffsprotokoll.

> Noch nicht da: die Rechte *Kommentar* und *Stempel* — sie stehen im Schema,
> aber es gibt noch keine Maske dafür.

---

## Postausgang

Alles, was das DMS nach außen schickt, geht durch das **Ausgangsbuch**. Kein
Modul versendet selbst.

**Warum ein Buch und nicht direkt senden?** Weil ein Versand fehlschlagen
kann, und zwar an einer Stelle, an der niemand hinsieht. Wenn der
Zahlungsstempel selbst die Mail an die Bank verschickt, entscheidet der
Mailserver darüber, ob der Stempel gilt: Ist er kurz nicht erreichbar,
scheitert entweder die Mail still oder die Freigabe. Beides ist falsch. Also
schreibt der Stempel einen Eintrag, und der Versand ist eine getrennte
Aufgabe, die man ansehen kann.

Ein Eintrag hat drei Zustände:

| Stand | Bedeutung |
|---|---|
| `offen` | Liegt bereit. Der Worker nimmt ihn beim nächsten Durchgang. |
| `gesendet` | Ist hinaus, mit Zeitpunkt. |
| `fehlgeschlagen` | Ist nicht hinaus. Der Grund steht dabei. |

Der Worker sieht alle halbe Minute nach. Was scheitert, bleibt **stehen** und
wird nicht von selbst wiederholt — ein Mailserver, der jetzt ablehnt, lehnt in
der nächsten Sekunde wieder ab, und ein Zähler, den niemand ansieht, ist keine
Lösung. Auf der Seite *Postausgang* steht der Grund, daneben *erneut
versuchen*. Die Zahl der bisherigen Versuche bleibt sichtbar, damit niemand den
Eintrag für unberührt hält.

**Ohne eingerichteten Mailversand geht nichts hinaus, aber auch nichts
verloren.** Sind `SMTP_URL` und `DMS_ABSENDER` nicht gesetzt, sagt die Seite
das oben ausdrücklich und alle Einträge bleiben `offen`. Das ist der Zustand
einer frischen Installation und kein Fehler.

### Flüchtige Einträge

Ein Eintrag kann ein Geheimnis enthalten — heute nur einer: die Mail mit dem
Link zur Belegeinsicht. Der Token steht darin im Klartext, denn anders käme
der Empfänger nicht hinein.

Solche Einträge sind **flüchtig**: Nach erfolgreichem Versand ersetzt die
Datenbank den Text durch einen Vermerk. Damit steht ein gültiger Zugangslink
höchstens die halbe Minute bis zum Versand im Ausgangsbuch und nicht die
ganze Laufzeit der Gewährung.

Scheitert der Versand, bleibt der Text stehen — sonst ginge die Wiederholung
leer hinaus.

Die Frage „was stand in dieser Mail" ist danach nur noch teilweise
beantwortbar, und das ist der Preis. Wer den Zugang selbst prüfen will, findet
in der Gewährung Empfänger, Umfang, Gültigkeit und Widerruf und im
Zugriffsprotokoll jeden Aufruf.

### Vorlagen

Betreff und Text kommen aus einer **Vorlage**, nicht aus dem Code. Vier gibt es
von Anfang an, in jedem neuen Mandanten:

| Schlüssel | Wofür |
|---|---|
| `zahlungsauftrag` | Zahlungsauftrag an die Bank, mit der Datei im Anhang |
| `einsicht_link` | Zugang zur Belegeinsicht für Eigentümer, Beirat, Mieter — der Eintrag ist **flüchtig**, siehe unten |
| `abtretung` | Abtretungserklärung an die ausführende Firma |
| `technikmeldung` | Meldung an eine Technik-Datenbank |

Platzhalter stehen in doppelten geschweiften Klammern: `{{rechnungsnummer}}`,
`{{kreditor}}`, `{{betrag}}`, `{{objekt}}`, `{{faellig}}`, `{{empfaenger}}`,
`{{link}}`, `{{gueltig_bis}}`, `{{heute}}`.

Zwei Regeln dazu, beide absichtlich:

**Ein unbekannter Name wird nicht eingesetzt, sondern bleibt stehen.** Wer
`{{rechnungsnr}}` schreibt, bekommt beim Speichern eine Meldung — und wenn er
sie überginge, stünde die Klammer in der Mail. Ein leerer Text an der Stelle
wäre schlimmer: Er fiele niemandem auf.

**Ein bekannter Name ohne Wert wird zu `—`.** Das Feld gab es, es war nur
nichts drin. Der Unterschied ist beim Lesen der Mail wichtig.

Vorlagen ändert man auf der Seite *Postausgang*. Geprüft wird **vor** dem
Speichern; schlägt die Prüfung an, bleibt das Formular offen und die Vorlage
unverändert.

> Noch nicht da: Vorlagen anlegen und löschen — es gibt die vier festen.
> Ebenso fehlt der Versand als PDF-Brief; hinaus geht bisher nur E-Mail.


---

## Schriftverkehr

Neben Rechnungen führt das System **Schriftstücke**: Behördenpost,
Anwaltsschreiben, Nachbarbeschwerden, Antworten des Verwalters. Sie laufen
durch denselben Posteingang, dasselbe Postfach und dieselbe Belegansicht —
es gibt keinen zweiten Weg.

Der Unterschied liegt in zwei Dingen:

**Was am Beleg steht.** Kein Betrag, keine Kontierung, kein Zahlungsweg.
Stattdessen: wer geschrieben hat, worum es geht, wann das Schreiben datiert
ist und **bis wann geantwortet sein muss**.

Der Absender ist Freitext. Ein Amt, ein Gericht oder ein Nachbar ist kein
Lieferant, und für jeden Absender einen Kreditor anzulegen machte den
Kreditorenstamm nach einem Jahr unbrauchbar. Wo es einen Stammsatz gibt, kann
er zusätzlich verknüpft werden.

**Welchen Weg er geht.** Schriftverkehr hat eine eigene Stufenfolge — im Seed
zwei Stufen: *Zur Kenntnis genommen* beim Objektverantwortlichen, dann
*Erledigt*. Keine Kontierung, keine Zahlung. Diese Folge ist **Konfiguration**
wie jede andere; sie lässt sich unter *Abläufe* ändern, ohne dass am Programm
etwas geschieht.

### Antwortfristen

Das fachlich wichtigste Feld. Eine versäumte Frist im Schriftverkehr kostet
mehr als ein verfallenes Skonto — und sie fällt niemandem von selbst auf,
weil kein Betrag daranhängt, den jemand vermisst.

Erledigte und stornierte Schreiben zählen nicht mehr mit; eine bereits
abgelaufene Frist wird mit negativer Zahl geführt und steht damit ganz oben.

### Aufbewahrung

**Sechs Jahre statt zehn** — ein Schriftstück ist ein Handelsbrief
(§ 147 Absatz 3 AO), kein Buchungsbeleg. Die Frist steht als Stammdatum je
Belegart; ist keine hinterlegt, gelten zehn Jahre, denn eine fehlende
Konfiguration darf nie zu einer kürzeren Frist führen.

## Auswertungen

Drei Zahlen, die man sonst nirgends sieht — weil jeder nur sein eigenes
Postfach kennt und dort alles erledigt aussieht.

### Verfallene Skonti

Die Zahl mit Geld daran, deshalb steht sie oben. Getrennt nach zwei Lagen,
und die Trennung ist der Punkt:

- **zu spät gezahlt** — der Beleg war freigegeben, die Zahlung ging nach
  Ablauf der Frist hinaus. Das Haus zahlt zu langsam.
- **noch nicht gezahlt** — die Frist ist vorbei und der Beleg liegt noch
  irgendwo. Das Haus gibt zu langsam frei.

Zusammengefasst wäre die Summe größer und die Auskunft kleiner: Man wüsste
nicht mehr, wo abzuhelfen ist. Unter der Summe stehen die fünfzig größten
Einzelfälle; jeder führt zum Beleg.

### Durchlaufzeiten je Stufe

Wie lange eine Stufe dauert, gemessen vom Eintritt bis zu dem Stempel, der
sie beendet.

**Der Median steht vor dem Mittel und ist die Zahl, auf die es ankommt.** Ein
einzelner Beleg, der über den Jahreswechsel liegen blieb, zieht das Mittel so
weit hoch, dass es nichts mehr aussagt. Daneben steht „9 von 10 unter" — das
ist die Zahl für die Frage, ob man jemandem eine Zusage machen kann.

Klärung und Rückgabe zählen **nicht** als Abschluss. Sie halten die Stufe an,
statt sie zu beenden; die Wartezeit läuft weiter und erscheint beim nächsten
Stempel. Wer sie mitzählte, bekäme kurze Durchlaufzeiten gerade für die
Belege, die am meisten Mühe gemacht haben.

Vorgabe sind die letzten **90 Tage**. Das ist kein willkürlicher Ausschnitt,
sondern eine Messung: Über den gesamten Bestand ist die Abfrage dreimal so
teuer und geht auf die Festplatte (siehe [messungen.md](messungen.md)).

### Älteste offene Belege

Der Einzelfall, nach dem der Lieferant anruft. Gerechnet **ab Eingang im
Haus**, nicht ab Start des Ablaufs — danach wird gefragt. Belege in Klärung
zählen als offen: Sie sind nicht erledigt, sie sind nur woanders. Wer sie
ausblendet, verliert genau die Fälle, die am längsten liegen.

> Die Auswertungen laufen unter **den Rechten des Fragenden**, nicht unter
> denen des Systems. Wer ein Objekt nicht sehen darf, findet es auch in
> keiner Summe wieder — aus einer Kennzahl lässt sich zurückrechnen.

## Archiv und Aufbewahrung

**Wenn der Ablauf durch ist, wird der Beleg archiviert** — sofort, nicht in
einem Nachtlauf. Ein Beleg zwischen letzter Freigabe und Archivierung ist noch
änderbar, und niemand weiß, wie lang dieses Fenster ist.

Danach ist Schluss: Betrag, Kontierung und Objektzuordnung lassen sich nicht
mehr ändern, der Beleg lässt sich nicht löschen. **Korrekturen laufen über
Storno plus Neuerfassung** — die Ersatzrechnung ist ein neues Dokument und
wird mit dem stornierten verkettet. So bleibt beantwortbar, warum es zwei
Belege über dieselbe Leistung gibt.

Abgelehnte Belege werden ebenfalls archiviert und **behalten ihren Status**
`abgelehnt`. Der Archiveintrag sagt, dass archiviert wurde; der Status sagt,
was aus dem Beleg geworden ist.

### Wie lange aufbewahrt wird

Die Frist steht als Stammdatum je Belegart — zehn Jahre für Buchungsbelege,
sechs für Handelsbriefe. Ist nichts hinterlegt, gelten zehn Jahre; eine
fehlende Konfiguration darf nicht zu einer kürzeren Frist führen.

**Die Frist läuft ab dem Ende des Jahres**, nicht ab dem Belegdatum
(§ 147 AO). Ein Beleg vom 2. Januar und einer vom 30. Dezember desselben
Jahres verfallen am selben Tag.

### Der Objektspeicher schützt die Datei selbst

Die Aufbewahrung ruht auf zwei Säulen. Die eine ist die **Hash-Kette**: Zu
jedem archivierten Beleg steht die Prüfsumme seiner Datei fest. Ändert jemand
die Datei, stimmt die Summe nicht mehr — das *erkennt* eine Änderung.

Die zweite ist der **Object Lock** des Objektspeichers. Er sorgt dafür, dass
das Original dabei nicht verlorengeht.

Wichtig ist, was er genau zusagt, denn es ist nicht das Naheliegende:

> **Object Lock verhindert das Überschreiben nicht.** Er bewahrt die alte
> Fassung daneben auf. Wer eine gesperrte Datei überschreibt, hat Erfolg — es
> entsteht eine zweite Fassung, und ein gewöhnliches Lesen liefert ab dann
> diese. Die gesperrte Fassung bleibt liegen und lässt sich **von niemandem**
> löschen, auch nicht vom Administrator des Speichers.

Deshalb hält das System zu jedem archivierten Beleg fest, *welche* Fassung
gesperrt wurde, und fordert beim Anzeigen, beim Export und in der Objektakte
genau diese an. Untergeschobenes fällt damit nicht nur auf — es kommt gar
nicht erst heraus.

Gesperrt wird **nach** dem Archivieren, in einem Durchgang alle fünfzehn
Minuten. Das ist Absicht: Eine Sperre im Compliance-Modus nimmt niemand mehr
zurück, auch der Administrator nicht. Wäre sie für eine abgebrochene
Archivierung gesetzt worden, läge die Datei bis zum Ende der Frist da und
niemand könnte etwas daran ändern. Eine *fehlende* Sperre ist dagegen
harmlos: Sie bleibt sichtbar offen und wird beim nächsten Durchgang
nachgeholt — auch für Belege, die archiviert wurden, bevor es den Speicher
gab.

**Ohne Objektspeicher läuft alles weiter, nur ungeschützt.** Die
Dateisystem-Ablage der Entwicklung kann nicht sperren und bekommt deshalb
*kein* Datum eingetragen — ein Datum, das nichts bewirkt, sieht aus wie ein
Schutz. Der Worker sagt beim Start, was er hat:

```
[worker] Ablage im Dateisystem, keine Objektsperre -- nur die Hash-Kette
```

#### Einrichtung

Vier Angaben in der Umgebung, dann nimmt die Anwendung den Speicher:

```
DMS_S3_EIMER=dms-belege
DMS_S3_SCHLUESSEL=...
DMS_S3_GEHEIMNIS=...
DMS_S3_ENDPUNKT=https://s3.eu-central-1.amazonaws.com
```

Fehlt bei gesetztem Eimer eines der Zugangsdaten, bricht der Start ab. Es gibt
keinen stillen Rückfall ins Dateisystem — eine Ablage, die klaglos woanders
hinschreibt, wäre die schlechteste Antwort.

> **Der Eimer muss mit Object Lock angelegt werden.** Nachträglich lässt sich
> das nicht einschalten; ein Eimer ohne Sperre bleibt für immer einer ohne.
> Das Sperren schlägt dann bei jedem Beleg fehl, und die Belege bleiben offen
> stehen. Wer den Speicher einrichtet, prüft das **vorher**.

Zum Ausprobieren genügt MinIO im Container:

```bash
npm run speicher:start
```

Es läuft dann unter `http://127.0.0.1:9000`, die Oberfläche unter Port 9001,
Benutzer und Passwort `dmsminio` / `dmsminio123`. `npm run speicher:stop`
räumt es wieder ab. Die Tests der Objektsperre nutzen es; fehlt es, prüfen sie
nur die Datenbankhälfte und sagen das ausdrücklich.

### Verfahrensdokumentation

Die dritte Säule. Hash-Kette und Objektsperre belegen, dass ein Beleg seit dem
Archivieren derselbe ist. Sie belegen nicht, **nach welchem Verfahren** er
dorthin kam — und ohne diesen Nachweis erkennt eine Betriebsprüfung die
Archivierung nicht an, egal wie gut die ersten beiden sind.

Der technische Teil wird **aus dem System erzeugt**: Tabellen, Trigger,
Zugriffsregeln, Ein- und Ausgangswege und die geprüften Zusicherungen. Das ist
kein Sparen an Sorgfalt, sondern das Gegenteil — eine von Hand gepflegte
Beschreibung eines Systems, das sich laufend ändert, ist nach einem Monat eine
Erzählung. Und eine falsche Verfahrensdokumentation ist schlimmer als gar
keine: Sie behauptet Kontrollen, und wer eine davon nachprüft, zweifelt danach
an allem anderen.

```bash
npm run verfahrensdoku
```

Der organisatorische Teil — Zuständigkeiten, Aufbewahrungsort, Sicherung,
Notfall — lässt sich nicht ableiten und steht von Hand in
`docs/verfahrensdoku-organisation.md`. Fehlt er, sagt das erzeugte Dokument
das an seiner Stelle.

#### Eine Fassung freigeben

Nicht jeder erzeugte Stand ist eine Fassung. Freigegeben wird, wenn sich am
Verfahren etwas geändert hat, das jemanden interessiert:

```bash
DMS_BENUTZER_FREIGABE=<kennung> npm run verfahrensdoku:freigeben
```

Damit wird der Text mit seinem Hash in der Ablage abgelegt, und **ab dem
Gültigkeitstag trägt jeder archivierte Beleg diese Versionsnummer**. Bei einem
Beleg aus 2027 ist damit später beantwortbar, nach welchem Verfahren er
*damals* verarbeitet wurde — nicht nach welchem heute.

Zwei Dinge weist der Befehl ab:

- **Einen veralteten Stand.** Passt das Dokument nicht mehr zum System, wird
  nicht freigegeben. Erst `npm run verfahrensdoku`.
- **Eine Fassung ohne Hash.** Ohne ihn wäre die Versionsnummer eine
  Behauptung.

Eine freigegebene Fassung lässt sich nicht mehr ändern und nicht löschen. Wer
etwas anderes beschreiben will, gibt eine neue frei.

> **Was vor der ersten Freigabe archiviert wurde, bleibt ohne Fassung.** Diese
> Lücke lässt sich nicht nachträglich schließen — sie wäre eine Behauptung
> über ein Verfahren, das damals nicht beschrieben war. Sie bleibt sichtbar
> und wird nicht stillschweigend gefüllt.

### Löschantrag an einem aufbewahrungspflichtigen Beleg

Ein Löschanspruch nach DSGVO trifft auf eine Aufbewahrungspflicht nach GoBD.
**Beides zu ignorieren wäre ein Verstoß, beides auszuführen auch** — nur gegen
verschiedene Gesetze.

Der Beleg wird deshalb nicht gelöscht, sondern die Verarbeitung wird
eingeschränkt: Er verschwindet **für alle** aus allen Sichten, auch für den
Objektverantwortlichen. Was sichtbar bleibt, ist der Eintrag darüber, dass ein
Antrag bearbeitet wurde — sonst wäre der Beleg unsichtbar und der Vorgang
spurlos.

Gelöscht werden darf er erst nach Ablauf der Aufbewahrung. Bis dahin steht er
in der Liste der Löschkandidaten mit seinem Fälligkeitsdatum. Eine
**Löschsperre** hält ihn darüber hinaus — laufendes Verfahren, Prüfung,
Rechtsstreit; ohne Begründung ist sie nicht setzbar.

> Noch nicht da: das eigentliche Löschen nach Fristablauf. Die Kandidatenliste
> steht, die Ausführung ist bewusst eine eigene Handlung — eine Funktion, die
> beides täte, würde irgendwann versehentlich aufgerufen.

### Verwalterwechsel: die Objektakte

```bash
DMS_BENUTZER_EXPORT=<benutzerkennung> npm run objektakte -- 42 ./export/objekt-42
```

Erzeugt ein Verzeichnis mit den Originaldateien, je Dokument einer
Metadatendatei (Beleg, Kontierung, Stempelhistorie samt Hashkette, Zahlungen)
und einem Manifest. Der Nachfolger prüft die Akte **ohne unser System**:

```bash
sha256sum -c manifest.txt
```

Belege ohne Originaldatei werden benannt, nicht verschwiegen — eine Akte mit
einer stillen Lücke ist schlimmer als eine mit einer bekannten. Eingeschränkte
Belege sind nicht enthalten.

Der Export läuft unter der Kennung eines Benutzers und damit unter dessen
Rechten. Das ist kein Umweg: Ein Export, der die Rechte umgeht, wäre ein
zweiter Zugang zu allen Daten.

---

## Löschen nach Fristablauf

Unter **Archiv**. Die Seite zeigt Belege, deren Aufbewahrungsfrist abgelaufen
ist — und was bereits gelöscht wurde.

**Wer aufbewahren muss, muss danach löschen.** Das ist keine Kür: Die
Aufbewahrungspflicht endet, und danach ist das Weiterspeichern selbst ein
Verstoß. GoBD und DSGVO zeigen an dieser Stelle in dieselbe Richtung.

### Zwei Gründe, und sie sind verschieden

| Grund | Was er bedeutet |
|---|---|
| **Löschanspruch** | Jemand hat die Löschung verlangt, die Frist steht nicht mehr entgegen. Dort wartet eine Person auf eine Antwort. |
| **Frist abgelaufen** | Niemand hat gefragt, aber die Aufbewahrung ist vorbei. Dieselbe Pflicht, nur ohne Dringlichkeit. |

Der zweite Fall fehlte bis zu diesem Stand vollständig: Die Kandidatenliste
kannte nur Belege mit Anspruch, und die Löschpflicht nach Fristablauf war
damit unerfüllbar.

### Was das Löschen aufhält

- Eine **Löschsperre** — laufendes Verfahren, Prüfung, Rechtsstreit. Sie ist
  stärker als der Fristablauf, sonst wäre sie wirkungslos. Solche Belege
  stehen nicht in der Liste.
- Eine **noch laufende Frist**. Der Versuch wird mit dem Datum abgewiesen, bis
  zu dem aufbewahrt wird.

### Es gibt keinen Knopf „alle löschen"

Gelöscht wird je Beleg. Ein Sammelknopf wird irgendwann versehentlich
gedrückt, und danach gibt es nichts, worauf man zurückgreifen könnte. Das ist
unbequem — und das ist der Punkt.

Auf der Liste steht **kein Belegtext**: Wer löschen darf, muss den Inhalt
nicht noch einmal lesen. Eine Löschliste mit Kreditor und Betrag wäre ein
zweiter Weg an den Beleg, vorbei an der Berechtigung dafür.

### Was bleibt

Ein Protokolleintrag: dass es den Beleg gab, wann seine Frist ablief, wer
gelöscht hat — **ohne personenbezogene Daten**. Eines, das den Namen behielte,
hätte nicht gelöscht.

Ohne dieses Protokoll wäre eine Lücke im Archiv nicht von einem Verlust zu
unterscheiden: Ein Prüfer, der einen Beleg sucht und nicht findet, könnte
nicht wissen, ob er gelöscht wurde oder abhandenkam.

### Die Datei folgt kurz danach

Der Beleg ist mit dem Klick gelöscht. Die Datei im Objektspeicher räumt der
Worker ab — stündlich. Bis dahin steht in der Liste „liegt noch".

Das ist Absicht: Ob der Objektspeicher gerade erreichbar ist, darf nichts
daran ändern, dass der Beleg gelöscht ist. Und es geht auf, weil die
Objektsperre genau bis zum Ende der Aufbewahrungsfrist läuft — vorher gibt der
Speicher die Datei nicht her, danach schon.

## Der Server

Das System läuft auf **einem** Server mit vier Containern: Datenbank,
Anwendung, Worker und einem Reverse Proxy, der die Verschlüsselung übernimmt.
Warum so und nicht bei einem Cloudanbieter, steht in
[ADR 0007](adr/0007-betriebsumgebung.md).

### Hochfahren

```bash
cp .env.beispiel .env
```

Ausfüllen — vier Angaben sind Pflicht, ohne sie startet der Verbund gar nicht
erst: Datenbankpasswort, Domäne, Basisadresse und das Sitzungsgeheimnis.
Danach die Rechte einschränken (`chmod 600 .env`); in dieser Datei stehen
alle Zugangsdaten, auch die der Mailpostfächer.

```bash
DMS_FASSUNG=$(git rev-parse --short HEAD) docker compose up -d --build
```

Die **Domäne muss wirklich auf diesen Server zeigen**, bevor Sie starten: Der
Proxy holt das Zertifikat selbsttätig, und dafür muss der Name auflösen.

### Änderungen am Datenmodell

Nicht beim Start, sondern von Hand — über einen SSH-Tunnel zur Datenbank, die
absichtlich nur auf der Rückadresse des Servers lauscht:

```bash
ssh -L 5433:127.0.0.1:5432 server
npx supabase db push --db-url "postgresql://postgres:PASSWORT@127.0.0.1:5433/postgres?sslmode=disable"
```

**`sslmode=disable` gehört dazu**, und das ist hier kein Nachlassen: Die
CLI bricht sonst mit *„The server does not support SSL connections"* ab. Die
Verbindung läuft bereits durch den SSH-Tunnel, ist also verschlüsselt — eine
zweite Schicht darunter fügte nichts hinzu. Die Datenbank lauscht außerdem
nur auf der Rückadresse des Servers; ohne Tunnel kommt niemand an sie heran.

Das ist Absicht und keine Unbequemlichkeit: Ein Container, der beim Start
selbst migriert, tut das nachts um drei, ohne dass jemand zusieht — und wenn
zwei Container gleichzeitig hochfahren, tun es beide.

### Läuft noch alles?

Der Worker ist der Prozess, dessen Ausfall man **nicht** sieht. An ihm hängen
die Texterkennung, die Objektsperre, das Abräumen gelöschter Dateien und die
tägliche Benachrichtigung. Fällt er aus, arbeitet die Oberfläche völlig
normal weiter — Belege kommen herein, Stempel lassen sich setzen — nur
geschieht im Hintergrund nichts mehr.

Deshalb trägt er jede Minute ein Lebenszeichen ein:

```bash
npm run betrieb:pruefen
docker compose logs -f worker
```

Meldet der Befehl *verstummt*, läuft der Worker nicht mehr oder kommt nicht
an die Datenbank. **Ein Dienst, der noch nie eingetragen hat, gilt ebenfalls
als verstummt** — sonst gäbe eine leere Liste ausgerechnet für den Fall
Entwarnung, in dem gar nichts läuft.

Dieselbe Auskunft im Browser gibt es unter `/api/lebenszeichen`, aber nur
vom Server aus: Nach außen ist der Pfad gesperrt.

### Wenn etwas nicht startet

| Meldung | Grund |
|---|---|
| `POSTGRES_PASSWORT fehlt` | `.env` nicht angelegt oder nicht ausgefüllt |
| Container `web` bleibt *unhealthy* | Datenbank nicht erreichbar — `docker compose logs db` |
| Kein Zertifikat | Die Domäne zeigt nicht auf diesen Server |
| Uploads scheitern ab einer Größe | Grenze in `next.config.ts` und `Caddyfile` gemeinsam anheben |

## Sicherung und Wiederherstellung

**Ein Archiv ohne getesteten Restore ist kein Archiv.** Deshalb gibt es hier
zwei Befehle und nicht einen.

### Sichern

```bash
npm run sicherung
```

Legt unter `sicherung/<datum>/` zwei Dateien ab: das Abbild der Datenbank und
ein **Manifest** mit den Zählwerten. Das Manifest ist der Teil, den man leicht
weglässt und ohne den die Probe nichts wert ist — wenn beim Zurückholen die
Hälfte der Belege fehlt, sieht die Datenbank in sich völlig stimmig aus. Erst
der Vergleich mit den Zahlen von vorher deckt es auf.

Die Belegdateien werden **nicht** mitgesichert. Sie liegen im Objektspeicher
mit Object Lock; ein zweiter Satz Kopien wäre ein zweiter Ort, an dem sie
altern. Wie der Objektspeicher gesichert wird, gehört in die
Verfahrensdokumentation — es ist eine Entscheidung über Infrastruktur.

> Ist `pg_dump` auf dem Rechner nicht installiert — in der Entwicklung ist das
> der Normalfall —, hilft `DMS_PG_CONTAINER=supabase_db_DMS` davor: Dann läuft
> es im Datenbankcontainer.

### Die Probe

```bash
npm run sicherung:pruefen -- sicherung/2026-09-02
```

Holt die Sicherung in eine **eigene, danach verworfene** Datenbank zurück —
nie in die laufende. Eine Probe, die den Betrieb überschreiben kann, wird aus
gutem Grund nie ausgeführt.

Geprüft wird, was ein erfolgreicher `pg_restore` gerade nicht beantwortet:

| Frage | Warum sie zählt |
|---|---|
| Lief das Zurückholen fehlerfrei? | jede Fehlerzeile ist ein Befund, kein Hinweis |
| Sind alle Zeilen da? | gegen das Manifest |
| Trägt die Hash-Kette? | wurde ein Ereignis nachträglich verändert? |
| Greifen RLS, Policies, Trigger? | **der eigentliche Grund** |
| Stimmen die Dateien zu ihren Hashes? | liegt noch das Original da? |

Die vierte Zeile ist die stillste Gefahr: `pg_restore` bringt Zeilen zurück
und sagt nichts darüber, ob die Zugriffsregeln daran hängen. Ein System ohne
RLS sieht im Betrieb völlig normal aus — es fällt erst auf, wenn jemand Daten
sieht, die ihn nichts angehen.

**Findet die Probe nichts vor, sagt sie das.** Enthält die Sicherung noch
keine Stempelereignisse und keine Archiveinträge, dann haben Kettenprüfung und
Dateiprüfung nichts angesehen — und die Probe belegt sie nicht. Eine Prüfung,
die in diesem Fall Entwarnung gibt, erzieht dazu, ihr zu glauben.

### Das Ergebnis gehört notiert

Datum und Ausgang jeder Probe gehören in die Verfahrensdokumentation. Eine
Probe, die niemand notiert, hat im Prüfungsfall nicht stattgefunden.

## Stammdaten

Alles, was da sein muss, bevor der erste Beleg hereinkommt: Objekte,
Kreditoren, Konten, Zahlungswege, Ordnungsgruppen und Aufbewahrungsfristen.
Bis zu diesem Stand ließen sie sich nur über die Datenbank anlegen — damit
konnte niemand außer einem Entwickler das System einrichten.

Sie stehen auf **einer** Seite und nicht auf sechs: Wer ein Objekt einrichtet,
braucht im selben Zug einen Zahlungsweg und eine Ordnungsgruppe. Die
Abschnitte stehen in der Reihenfolge, in der man sie bei der Ersteinrichtung
braucht.

### Zwei Rechte, nicht eines

| Recht | Wofür | Wer im Auslieferungsstand |
|---|---|---|
| Stammdaten pflegen | Objekte, Kreditoren, Konten, Zahlungswege, Gruppen, Fristen | Buchhaltung, Geschäftsleitung |
| Benutzer verwalten | Benutzer, Rollen, Rollenzuweisungen, Zuständigkeiten | nur Geschäftsleitung |

Die Trennung ist kein Feinschliff. Einen Kreditor anzulegen ist
Tagesgeschäft. **Rollen zu vergeben ist es nicht:** Wer das darf, kann sich
jedes andere Recht selbst geben — es ist das Recht, aus dem alle anderen
folgen. Beides zusammenzufassen hieße, der Buchhaltung nebenbei die
Benutzerverwaltung zu geben.

Wer ein Recht nicht hat, sieht die Listen trotzdem — nur ohne Formulare. Das
ist Absicht: Auch wer nicht ändern darf, hat Grund nachzusehen, welches Konto
es gibt.

### Was nicht gelöscht wird

Objekte, Konten und Ordnungsgruppen lassen sich **deaktivieren, nicht
löschen**. An ihnen hängen Kontierungszeilen und Archiveinträge; gelöscht
wäre die Frage „worauf wurde das gebucht" für immer unbeantwortbar.

Dasselbe bei Rollen und Zuständigkeiten: Sie werden **beendet**, nicht
entfernt. Wer wann welche Rolle trug, ist die Antwort auf „wer durfte das
damals" — und die wird gestellt, wenn ein alter Beleg geprüft wird.

### Bankverbindungen

Eine Bankverbindung zu bestätigen heißt zu erklären: *Ich habe geprüft, dass
dieses Konto zu diesem Kreditor gehört.* Das ist der Betrugsschutz — ohne
verifizierte Bankverbindung geht keine Zahlung hinaus.

Deshalb ist es ein eigener Knopf und kein Feld in einem Formular, und deshalb
hält die Datenbank fest, **wer** bestätigt hat. Sie tut das auf jedem Weg;
auch wer die Maske umgeht, hinterlässt seinen Namen.

Neue IBANs entstehen von selbst, sobald sie auf einem Beleg auftauchen — sie
stehen dann als *neu* da und warten auf jemanden, der hinsieht.

### Benutzer anlegen heißt nicht: Zugang geben

Angelegt wird die **Kennung**. Ob jemand hereinkommt, entscheidet die
Anmeldung über Entra ID; die Verknüpfung entsteht bei der ersten Anmeldung.

Ein Benutzer ohne Rolle sieht nichts. Das ist die richtige Vorgabe — aber es
fällt sonst erst auf, wenn er sich das erste Mal anmeldet. Deshalb steht in
der Liste rot, wer keine Rolle hat.

### Eingangsquellen einrichten

Unter **Eingangsquellen**: ein überwachter Ordner oder ein Mailpostfach. Was
von dort hereinkommt, geht durch denselben Eingang wie ein Upload — dieselbe
Dublettenprüfung, dieselbe Aufbereitung.

> **Die Maske hat kein Passwortfeld, und das ist Absicht.** Eingetragen wird
> der *Name* einer Umgebungsvariablen; das Geheimnis selbst liegt auf dem
> Rechner, auf dem der Worker läuft. Ein Datenbankauszug gibt damit keinen
> Postfachzugang her — und was sich nicht eingeben lässt, kann auch nicht
> versehentlich gespeichert werden.

Neben dem Variablennamen steht, ob sie auf diesem Server **gesetzt** ist. Das
ist die Auskunft, die sonst fehlt: Eine Quelle mit fehlendem Passwort
scheitert beim nächsten Lauf, und der Fehler fällt erst auf, wenn jemand eine
Rechnung vermisst.

Ebenso sichtbar: **wer die Quelle trägt.** Sie arbeitet unter den Rechten
ihres Einrichters, nicht unter einem technischen Konto — am Beleg steht
dadurch ein Name, den man fragen kann. Ist diese Person gesperrt, steht die
Quelle still, und die Liste sagt es.

Einrichten darf, wer Abläufe konfigurieren darf. Eine Eingangsquelle
bestimmt, welche Belege überhaupt entstehen — das ist keine Sachbearbeitung.

### Vorlagen für die Ausgangspost

Unter **Stammdaten → Vorlagen**: Betreff und Text der Mails, die das Haus
verlassen — Zahlungsauftrag, Einsichtslink, Abtretungserklärung.

**Die Vorschau ist der Punkt der Seite.** Unter jedem Textfeld steht, wie die
Mail mit Beispielwerten aussieht. Wer eine Formulierung ändert, die an eine
Bank oder einen Versicherer geht, will sehen, was ankommt — ein Eingabefeld
allein zeigt nur, was jemand getippt hat.

Die Beispielwerte sind **erfunden**. Die Vorschau mit dem zuletzt versandten
Beleg zu füllen wäre naheliegend und falsch: Sie wäre ein zweiter Weg, einen
Beleg zu lesen, vorbei an der Berechtigung dafür.

#### Platzhalter

Oben auf der Seite steht, welche es gibt — und es gibt nur diese. Eine freie
Vorlagensprache könnte den ganzen Belegtext in eine Mail schreiben, an einen
Empfänger, den ein Stammdatum bestimmt.

| Fall | Was geschieht |
|---|---|
| unbekannter Platzhalter | wird beim **Speichern abgewiesen** |
| bekannter, aber ohne Wert | wird zu einem Strich — die Angabe fehlt am Beleg |

Steht ein unbekannter Platzhalter doch in einer Vorlage — etwa aus einer
älteren Fassung —, bleibt er beim Versand **stehen** statt zu verschwinden.
Das ist die unbequemere Wahl und die richtige: So fällt der Tippfehler beim
Blick auf die Vorschau auf, statt einer Bank eine Mail mit einer Lücke zu
schicken. Die Seite markiert solche Vorlagen rot.

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

## Benachrichtigungen

Zwei Wege, und sie sind bewusst verschieden dosiert.

### Die Zahl neben „Postfächer"

Steht in der Navigation, sobald etwas offen ist — blau, und rot, sobald
etwas über der Frist liegt. Sie ist die wirksamere Hälfte: Die Mail kommt
einmal am Tag, diese Zahl sieht man den ganzen Tag.

Bei null Aufgaben steht dort nichts. Eine Null neben jedem Eintrag wäre
Rauschen, und Rauschen macht die eine Zahl unsichtbar, auf die es ankommt.

### Die tägliche Sammelmail

Eine Mail am Tag, zur gewünschten Uhrzeit — und **nur, wenn etwas offen
ist**. Einstellbar unten im Postfach; ohne Einstellung ist sie an, um 7 Uhr.

> **Warum keine Mail je Aufgabe.** Die erste Idee, und sie hält zwei Wochen.
> Danach filtert sie jeder in einen Ordner, den niemand öffnet — und dann ist
> auch die eine Mail verloren, die wichtig war. Ein Postfach mit vierzig
> ungelesenen Systemmails ist schlechter als gar keine Benachrichtigung, weil
> es Sicherheit vortäuscht.

**In der Mail stehen keine Belegdaten.** Kein Kreditor, kein Betrag, keine
Rechnungsnummer — nur zwei Zahlen und ein Link hierher.

Das ist Absicht: Ein Postfach ist schlechter geschützt als dieses System. Es
hat keine Berechtigungen, keine Sitzung und kein Zugriffsprotokoll, und es
wird auf Geräten gelesen, über die niemand Auskunft geben kann. Eine
Aufzählung der fälligen Belege wäre eine zweite, schwächere Kopie des
Bestands — und sie entstünde jeden Tag neu.

Die Mail ist ein Anstoß, kein Bericht. Gearbeitet wird im System.

### Wenn keine Mail ankommt

Drei Möglichkeiten, in dieser Reihenfolge:

1. **Nichts offen.** Dann kommt keine — das ist richtig so.
2. **Abgeschaltet.** Steht unten im Postfach.
3. **`DMS_BASIS_URL` fehlt.** Ohne sie weiß der Worker nicht, wohin der Link
   zeigen soll, und schickt deshalb gar nichts; er sagt es beim Start. Eine
   Mail mit einem Link ins Leere kostet den Empfänger zweimal Zeit — beim
   Lesen und beim Nachfragen.

Gesendet wird über das Ausgangsbuch wie jede andere Post: Was nicht hinausging,
steht dort mit Grund.

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
