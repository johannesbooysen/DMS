# ADR 0009: Stempel platzieren, bevor er gilt

**Status:** angenommen, 27.09.2026

## Kontext

Bis hierher war der Klick auf den Stempelknopf die Entscheidung. Den Abdruck
wählte die Datenbank: der nächste freie Block auf Seite 1, vom Worker bei
der Aufbereitung gerechnet (`app.stempelplatz`). Wer stempelte, sah den
Stempel erst danach, in der Belegansicht, und konnte ihn dort verschieben
(ADR 0008).

Rückmeldung beim Bedienen: Der Stempel soll beim Stempeln sichtbar auf dem
Beleg liegen, und der Vorgang soll mit *Speichern* abgeschlossen werden. Und
wer die nächste Stufe bearbeitet, soll den Stempel der vorigen auf dem Beleg
sehen. Letzteres galt am Arbeitsplatz schon, auf der einzelnen
Aufgabenseite nicht: Dort stand eine Vorschau ohne Layer.

## Entscheidung

1. **Die Lage steht am Ereignis.** `stempel_ereignis.lage` trägt
   `{seite, x, y, breite, hoehe}` in PDF-Punkten, wenn der Mensch den Abdruck
   platziert hat. Der Layer-Trigger nimmt diese Lage statt des errechneten
   Platzes, nachdem `app.stempel_lage_pruefen` sie geprüft hat, mit denselben
   Regeln wie beim Verschieben: Mindestmaß, Seitenrand, kein Text, kein
   anderer Stempel. Eine Lage, die dort nicht stehen darf, weist die
   Anwendung mit Satz ab, und der Trigger weist sie ab, wenn jemand die
   Anwendung umgeht. Ohne Lage bleibt alles wie bisher.

2. **Die Lage ist nicht Teil der Hash-Kette**, wie der Stempeltext auch
   nicht. Die Kette belegt die Entscheidung: wer, was, wann. Wo der Abdruck
   auf der Seite sitzt, ist Darstellung. Bestehende Ereignisse tragen `null`.

3. **Drei Schritte auf der Entscheidungsseite:** Stempel wählen, den Abdruck
   auf dem Beleg ziehen, *Speichern*. Die Knöpfe entscheiden nicht mehr
   selbst. Der Zustand (welcher Stempel, wo) liegt in einem React-Kontext,
   weil die Wahl rechts im Formular steht und der Abdruck links über dem
   Seitenbild. Das Formular bleibt ein Serverformular; Stempeltyp und Lage
   stehen als verborgene Felder darin.

4. **Beide Entscheidungsseiten zeigen den Beleg mit allen Layern**
   (`Belegbetrachter`, wie am Arbeitsplatz). Die Vorschau ohne Layer
   (`belegvorschau.tsx`) entfällt.

## Was nicht entschieden wurde

- Der Abschlussstempel in der Kontierungsmaske wird weiter automatisch
  platziert. Er steht unter der Summe, nicht neben dem Beleg; ein Abdruck
  zum Ziehen gehörte dort in eine Maske, die schon voll ist.
- Platziert wird auf Seite 1. Auf eine andere Seite kommt ein Stempel wie
  bisher nachträglich, über das Verschieben (ADR 0008).
- Der Vorschautext trägt Datum und Uhrzeit von jetzt; der Trigger schreibt
  die Zeit des Speicherns. Die Sekunden dazwischen sind keine Abweichung, die
  jemand bemerkt.

## Folgen

- Migration `20261001120000_stempel_lage.sql`, `Stempelvorgang.lage` in der
  Engine, `stempelSetzen` prüft vorab, `platzierungLaden` liefert Seite 1 mit
  Vorschlag, Maßen, Textkästen und belegten Plätzen.
- Browsertests klicken nach dem Stempelknopf *Speichern*.
- `tests/stempel-lage.test.ts` nagelt die vier Zusicherungen fest.
