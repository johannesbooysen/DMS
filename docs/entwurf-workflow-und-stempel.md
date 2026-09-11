# Entwurf: Ablauf je Kategorie, Stempel frei platzierbar

**Status: Vorschlag, nicht entschieden.** Die offenen Fragen stehen am Ende;
ohne ihre Beantwortung würde ich raten. Ist der Entwurf angenommen, wird
daraus je Hälfte ein ADR und dann Code.

> **Nachtrag nach der Bestandsanalyse.**
> [analyse-amagno-bestand.md](analyse-amagno-bestand.md) wertet das
> Workflow-Diagramm des abzulösenden Systems aus. Drei Änderungen an diesem
> Entwurf folgen daraus:
>
> - **Frage 2 („was nervt an Amagno") ist beantwortet** — durch den Bestand
>   selbst. Die Antworten stehen dort in den Abschnitten 1 bis 9.
> - **Frage 1 war falsch gestellt.** Der Kreditor *wählt* im Bestand keinen
>   Ablauf, er *füllt* die Felder, die ihn wählen. Das sind zwei
>   Mechanismen; welcher gemeint ist, ist jetzt Frage 1 der Analyse.
> - **Neu hinzugekommen ist die Ausführbarkeitsprüfung** (Analyse,
>   Abschnitt 4): ob überhaupt jemand die Stempel einer Stufe setzen darf.
>   Sie fehlt hier, sie fehlt in Amagno, und sie fehlt in unserer
>   `app.prozessbaum_pruefen`.

---

## 1. Was heute schon steht — und was nicht

Damit die Lücke benannt ist und nicht der Eindruck entsteht, es sei nichts da:

| | Stand |
|---|---|
| Ablauf als **Blockbaum** statt starrer Kette (`nacheinander`, `gleichzeitig`, `verzweigung`, `stufe`) | gebaut ([ADR 0002](adr/0002-workflow-modell.md)) |
| Bedingungen als `jsonb` über einer **Weißliste** (Betrag, Ordnungsgruppe, Belegart …) | gebaut |
| **Versionierung**: laufende Belege behalten ihre Fassung (`dokument_lauf.definition_version`) | gebaut |
| **Simulation** vor dem Aktivieren, **Prüfung** des Baums | gebaut, unter *Abläufe* |
| **Objekt-Ausnahmen** (`prozess_override`) | Tabelle da, Oberfläche dünn |
| Stempel entsteht **aus seinem Ereignis**, nie von Hand | gebaut (Trigger, Hash-Kette) |
| Stempel findet **automatisch eine textfreie Stelle** (`freie_bloecke`) | gebaut |
| Kein Platz auf der Seite → Stempel auf angehängte Leerseite statt Verlust | gebaut |

**Was fehlt — genau die zwei Punkte aus deiner Rückmeldung:**

1. **Der Ablauf wird nur nach `belegart` und `ordnungsgruppe` gewählt.**
   Ein Kreditor kann heute keinen eigenen Ablauf bekommen. Die Auswahl steht
   fest verdrahtet in `src/workflow/engine.ts`:

   ```sql
   and p.belegart = d.belegart
   and (p.ordnungsgruppe_id = d.ordnungsgruppe_id or p.ordnungsgruppe_id is null)
   order by p.ordnungsgruppe_id nulls last, p.version desc
   ```

2. **Ein Stempel lässt sich nicht bewegen.** `app.layer_anlegen` weist es
   ausdrücklich ab: *„Ein Stempel entsteht aus seinem Ereignis, nicht von
   Hand."* Und Layer sind unveränderlich — sie werden ausgeblendet, nie
   geändert.

---

## 2. Ablauf je Kategorie

### 2.1 Der naheliegende Weg und warum ich ihn nicht nehme

Naheliegend wäre, `prozessdefinition` weitere Spalten zu geben:
`kreditor_id`, `vertrag_id`, `verwaltungsart`, `objekt_id`, `betrag_ab` …

Das bricht an zwei Stellen:

- **Die Spalten hören nie auf.** Nach dem Kreditor kommt der Vertrag, dann
  die Verwaltungsart, dann der Eingangskanal. Jede ist eine Migration.
- **„Welcher Ablauf gilt hier?" wird unbeantwortbar.** Schon heute
  entscheidet ein `order by … nulls last` — bei sechs Spalten wäre die
  Rangfolge eine Regel, die niemand mehr im Kopf hat.

### 2.2 Vorschlag: Geltungsbereich statt Schlüsselspalten

Eine Prozessdefinition bekommt einen **Geltungsbereich** — dieselbe Art
Bedingung, die es an den Verzweigungen schon gibt, über derselben Weißliste:

```
prozessdefinition   … geltungsbereich jsonb,   -- Bedingungen wie an Knoten
                      prioritaet integer not null default 100
```

```jsonc
// „Alles von den Stadtwerken über 1.000 €"
{ "und": [
    { "feld": "kreditor.kurzcode", "ist": "STADTWERKE" },
    { "feld": "brutto", "groesser": 1000 }
]}
```

Damit ist „je Kategorie" keine feste Liste mehr: Kreditor, Ordnungsgruppe,
Verwaltungsart, Objekt, Betrag, Vertrag — alles, was in der Weißliste steht,
kann einen eigenen Ablauf begründen. Ein neuer Zuschnitt ist Stammdatenarbeit,
keine Migration.

**`belegart` bleibt eine eigene Spalte.** Sie ist keine Kategorie unter
anderen, sondern bestimmt, welche Faktentabelle überhaupt hängt. Sie gehört
in den Index und nicht in eine Bedingung.

### 2.3 Die Rangfolge muss ein Mensch setzen, nicht ein `order by`

Passen mehrere Definitionen, entscheidet **`prioritaet`** — eine Zahl, die
jemand vergeben hat. Bei Gleichstand gewinnt die höhere Version, und die
Prüfung meldet den Gleichstand als Befund, statt ihn stillschweigend
aufzulösen.

### 2.4 Die Zuordnung muss sich erklären

Das ist die Bedingung, unter der 2.2 überhaupt tragbar ist — und der Punkt,
an dem „benutzerfreundlicher als Amagno" konkret wird.

Zu jedem Beleg beantwortbar, in einem Satz:

> **Ablauf „Versorger, Freigabe ab 1.000 €", Fassung 3** — gewählt, weil
> Belegart = Rechnung, Kreditor = Stadtwerke Musterstadt und Brutto =
> 1.240,00 € > 1.000,00 €. Zwei weitere Abläufe hätten gepasst
> („Rechnung Standard", „Betriebskosten"), beide mit niedrigerer Priorität.

Sichtbar am Beleg **und** in der Simulation. Ohne diese Erklärung ist ein
regelbasierter Geltungsbereich schlechter als die heutige starre Auswahl —
mit ihr ist er besser als eine Liste, die man auswendig lernen muss.

### 2.5 Was sich für laufende Belege nicht ändert

`dokument_lauf.definition_version` friert die Fassung ein. Ändert jemand
einen Geltungsbereich, wandert **kein** laufender Beleg in einen anderen
Ablauf. Sonst hinge eine halb geprüfte Rechnung plötzlich in einer Stufe, die
es beim Start nicht gab.

### 2.6 Bedienung

Der heutige Baukasten unter *Abläufe* zeigt den Blockbaum mit ↑ ↓ und
*entfernen*. Das ist ehrlich, aber karg. Vorschlag:

- **Der Geltungsbereich steht oben als Satz**, nicht als JSON: „Gilt für
  Rechnungen · Kreditor Stadtwerke · ab 1.000 €" mit Auswahlfeldern
  dahinter.
- **Simulation dauerhaft daneben**, nicht hinter einem Knopf: Wer eine Stufe
  verschiebt, sieht sofort die resultierende Kette für einen Beispielbeleg.
- **Kopieren als Ausgangspunkt**: „Wie Rechnung Standard, aber …" — der
  häufigste Fall, und er soll nicht bei null beginnen.
- **Der Entwurf bleibt Entwurf**, bis jemand ihn aktiviert. Das gibt es schon;
  es muss nur sichtbarer sein.

---

## 3. Stempel: schwebend und frei platzierbar

### 3.1 Die Invariante, die bleibt

**Ein Stempel entsteht aus seinem Ereignis.** Er ist der sichtbare Teil einer
Entscheidung, die in der Hash-Kette steht. Wer einen Stempel von Hand malen
könnte, könnte eine Freigabe behaupten, die nie stattgefunden hat.

Daran ändert sich nichts. Verhandelbar ist **die Position**, nicht die
Herkunft.

### 3.2 Vorschlag: Vorschlag automatisch, Feinschliff von Hand

| | |
|---|---|
| Beim Stempeln | Platz **automatisch** aus `freie_bloecke` — wie heute, kein Text darunter |
| Danach | Wer den Beleg bearbeiten darf, kann den Stempel **verschieben** und auf eine andere Seite legen |
| Beim Verschieben | Textfreie Blöcke rasten ein („einschnappen"), freies Ablegen bleibt möglich |
| Nach Archivierung | Position ist fest, wie der Beleg selbst |

### 3.3 Die harte Frage: Layer sind unveränderlich

Heute gilt: `dokument_layer` wird ausgeblendet, nie geändert. Verschieben
verletzt das. Zwei Wege:

**(a) Position ist änderbar, mit Protokoll.** Ein `layer_position_ereignis`
hält jede Verschiebung fest (wer, wann, von wo nach wo). Der Layer bleibt
sonst unverändert und behält seine Bindung ans Stempelereignis.
*Dafür:* eine Zeile je Stempel, einfache Anzeige. *Dagegen:* der
Unveränderlichkeits-Trigger bekommt eine Ausnahme — und Ausnahmen an
Schutztriggern sind die Stelle, an der später etwas durchrutscht.

**(b) Alter Layer wird ausgeblendet, neuer entsteht.** Kein Trigger wird
angefasst; die Historie ergibt sich von selbst. *Dagegen:* Ein Beleg, den man
dreimal zurechtrückt, trägt vier Layer, von denen drei ausgeblendet sind —
und jede Auswertung über Layer muss das wissen.

**Ich neige zu (a)**, weil die Ausnahme eng und benennbar ist: *nur*
`x`, `y`, `seite`, *nur* solange nicht archiviert, *nur* mit Protokolleintrag.
Der Trigger prüft genau das — er bekommt keine Fahne, die jemand setzen kann,
sondern eine nachprüfbare Bedingung, wie bei `app.loeschung_faellig`.

### 3.4 Was „schwebend" technisch heißt

- Ziehen mit der Maus, Verschieben mit den Pfeiltasten (Barrierefreiheit).
- Position in **Prozent** der Seite, nicht in Pixeln — sonst verrutscht sie
  beim Skalieren. Das gilt schon heute für die Anzeige.
- Beim Loslassen: nächster freier Block innerhalb einer Toleranz rastet ein,
  sonst bleibt die Position, wo sie ist.
- Der Export zeichnet Layer bereits an ihrer Position — er folgt ohne Änderung.

### 3.5 Darf ein Stempel Text überdecken?

**Automatisch nie.** Von Hand: Das ist eine Entscheidung, die ich dir nicht
abnehmen kann — siehe Frage 6.

---

## 4. Fragen

Ohne Antworten würde ich raten. Die ersten drei bestimmen den Zuschnitt, der
Rest die Feinheiten.

**1. Nach welchen Merkmalen soll der Ablauf wirklich gewählt werden?**
Kreditor ist gesetzt. Was noch — Vertrag, Verwaltungsart (WEG/Miet/SE),
Objekt, Betrag, Eingangskanal, Spezialgebiet? Je Merkmal ein Satz, wofür du
es brauchst; daraus wird die Weißliste.

**2. Was genau nervt dich an Amagno?**
Das ist die wichtigste Frage, und ich kann sie nicht selbst beantworten.
„Benutzerfreundlicher" ist sonst ein Wort ohne Prüfstein. Zwei, drei konkrete
Ärgernisse genügen — dann baue ich dagegen, nicht ins Blaue.

**3. Wer darf Abläufe ändern?**
Heute nur, wer `prozess_konfigurieren` trägt (Geschäftsleitung). Soll die
Buchhaltung einem Kreditor einen anderen Ablauf zuordnen dürfen, **ohne** den
Ablauf selbst ändern zu können? Das wären zwei getrennte Rechte.

**4. Wie viele Abläufe erwartest du realistisch?**
Drei bis fünf, oder eher zwanzig? Bei fünf reicht eine Liste; bei zwanzig
braucht es Suche, Gruppierung und einen Überblick, welcher Ablauf wo greift.

**5. Wer darf einen Stempel verschieben?**
Nur wer ihn gesetzt hat? Jeder mit `bearbeiten` am Beleg? Und bis wann —
bis zur nächsten Stufe, oder bis zur Archivierung?

**6. Darf ein von Hand gesetzter Stempel Text überdecken?**
Dagegen spricht die Lesbarkeit des Belegs — ein verdeckter Betrag ist im
Prüfungsfall unangenehm. Dafür spricht, dass du es manchmal genau so willst.
Mein Vorschlag: erlauben, aber sichtbar warnen.

**7. Soll die Größe eines Stempels veränderbar sein, oder nur die Position?**
Größe verändern heißt: Der Stempel kann klein und unleserlich werden.

**8. Auf welche Seite gehört ein Stempel bei mehrseitigen Belegen?**
Heute: Seite 1, sonst angehängte Leerseite. Soll man ihn auf Seite 3 legen
dürfen — und was ist der sinnvolle Vorschlag bei einem 20-seitigen Beleg?

**9. Was soll auf dem Stempel stehen?**
Heute: Entscheidung, Name, Datum. Zusätzlich denkbar: Objektnummer, Betrag,
Kommentar, Stufe. Mehr Text heißt größerer Stempel und weniger freie Plätze.

---

## 5. Wenn das entschieden ist

In dieser Reihenfolge, weil jede Stufe die nächste trägt:

1. **Weißliste erweitern** um die Merkmale aus Frage 1, mit Tests je Merkmal.
2. **Geltungsbereich und Priorität** an `prozessdefinition`; Auswahl in der
   Engine darauf umstellen. Die heutige Auswahl bleibt als Sonderfall gültig
   (leerer Geltungsbereich = gilt für alles), damit nichts umzuziehen ist.
3. **Zuordnungserklärung** — erst danach ist der Rest bedienbar.
4. **Oberfläche**: Geltungsbereich als Satz, Simulation daneben, Kopieren.
5. **Stempel verschieben**: Protokolltabelle, Trigger-Ausnahme, Ziehen im
   Browser, Einrasten an freien Blöcken.

Punkt 1 bis 3 sind die Substanz; 4 und 5 sind sichtbar, aber tragen nichts,
solange die Auswahl nicht erklärbar ist.
