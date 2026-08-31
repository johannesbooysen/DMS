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

> Noch nicht gebaut: die Plausibilitätsprüfungen und damit die Gesamtampel —
> darunter die harten Fälle „IBAN passt nicht zum Kreditor" und „Dublette".


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

> Noch nicht da: der **Object Lock** im Objektspeicher. Er wird von S3
> durchgesetzt, nicht von der Datenbank; die Dateisystem-Ablage der
> Entwicklung kann ihn nicht und bekommt deshalb *kein* Datum eingetragen.
> Ein Datum, das nichts bewirkt, sieht aus wie ein Schutz.

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
