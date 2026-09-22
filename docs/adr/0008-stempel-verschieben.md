# 0008 — Stempel verschieben: Herkunft bleibt das Ereignis, Lage wird frei

**Stand:** angenommen (22.09.2026)

## Kontext

Das Konzept (§16) und Migration 20260901120000 legen fest: Ein Stempel
entsteht aus seinem Ereignis, nie von Hand; der Worker sucht ihm eine
textfreie Stelle; Layer werden ausgeblendet, nie geändert. Das schützt die
Hash-Kette — wer einen Stempel malen könnte, könnte eine Freigabe behaupten.

Die Anforderung aus dem Amagno-Vergleich lautet: Stempel sollen *schwebend
und frei applizierbar* sein, automatisch aber dort landen, wo kein Text ist.
Die Antworten auf die offenen Fragen des Entwurfs
([entwurf-workflow-und-stempel.md](../entwurf-workflow-und-stempel.md)):

| Frage | Antwort |
|---|---|
| Wer darf verschieben, bis wann? | Wer den Stempel gesetzt hat — bis zur nächsten Stufe |
| Darf ein Stempel Text überdecken? | Nein |
| Größe änderbar? | Position **und** Größe |
| Welche Seite? | Frei wählbar, Vorgabe Seite 1 |
| Was steht darauf? | Stempeltext, Datum + Uhrzeit, Mitarbeiter — und später ein Stempel-Designer |

## Optionen

**A — Position änderbar, mit Protokoll.** Der Layer bleibt an sein Ereignis
gebunden; `seite`, `x`, `y`, `breite`, `hoehe` werden unter Bedingungen
änderbar, jede Änderung landet in einem append-only-Protokoll. Der
Unveränderlichkeits-Trigger bekommt eine Ausnahme.

**B — Alter Layer ausblenden, neuer entstehen.** Kein Trigger wird angefasst;
die Historie ergibt sich. Aber der neue Layer hätte kein eigenes Ereignis —
und *„ein Stempel entsteht aus seinem Ereignis"* gälte nur noch für den
ersten. Jede Auswertung über Layer müsste ausgeblendete Vorgänger kennen.

**C — Freie Platzierung, Textüberdeckung erlaubt mit Warnung.** Abgelehnt
durch die Antwort auf Frage 6.

## Entscheidung

**A**, mit einer Ausnahme, die der Trigger **selbst nachprüft** — keine
Fahne, kein Sitzungsschalter. Dieselbe Bauart wie `app.loeschung_faellig`:
Eine nachprüfbare Tatsache öffnet die Tür, nicht ein Aufrufer, der behauptet,
er dürfe.

Die Tatsachen (`app.stempel_verschiebbar`, `app.stempel_lage_pruefen`):

1. Der Layer ist ein Stempel mit Ereignis und nicht ausgeblendet.
2. Der Handelnde ist der Urheber des Ereignisses.
3. Auf dem Lauf steht kein späteres Stempelereignis. *„Bis zur nächsten
   Stufe"* heißt: Sobald jemand danach gestempelt hat, ist der Stempel Teil
   eines Verlaufs, den andere gesehen haben.
4. Der Beleg ist nicht archiviert.
5. Mindestmaß 120 × 40 Punkte; innerhalb des Seitenrands.
6. Kein Textkasten der Zielseite wird berührt (Abstand 6 Punkte, wie beim
   Worker); kein anderer Stempel wird überdeckt. Seite 0 (Leerseite) ist
   immer frei.

Damit die Datenbank Punkt 6 prüfen kann, speichert der Worker je Seite die
**Textflächen als Zeilenkästen** (`dokument_seite.textkaesten`). Wörter wären
bei einer Million Belegen zweistellige Gigabytes; Zeilen sind rund ein
Zehntel. Eine Zeile wird konservativ zu *einem* Kasten vom ersten bis zum
letzten Wort — lieber ein Platz zu wenig als ein Stempel auf einer Zahl.

Das Protokoll (`layer_position_ereignis`) schreibt ein zweiter Trigger,
nicht der Aufrufer: Jede Verschiebung hinterlässt eine Spur, gleich auf
welchem Weg sie kam.

## Konsequenzen

- Der Riegel `dokument_layer_unveraenderlich` hat jetzt eine benannte, enge
  Ausnahme. Wer eine zweite baut, baut sie als nachprüfbare Bedingung, nicht
  als Flag.
- Seiten, die vor dieser Migration aufbereitet wurden, haben keine
  Textkästen; dort ist Verschieben bis zur erneuten Aufbereitung nicht
  möglich, und die Fehlermeldung sagt das.
- Der Export zeichnet Layer bereits an ihrer Position — er folgt ohne
  Änderung. Ein verschobener Stempel steht im PDF, wo er im Viewer steht.
- Der Layertext trägt jetzt die Uhrzeit (Ortszeit Europe/Berlin). Er wird
  nicht gehasht; die Kette hängt am Ereignis.
- Der **Stempel-Designer** (Aussehen, Felder, Anordnung je Stempeltyp) ist
  ein eigener Punkt und nicht Teil dieser Entscheidung.
- Ziehen mit der Maus im Browser verlangt Zeigerkoordinaten aus dem
  Ereignis. Der Riegel `lib: ["ES2023"]` ohne `DOM` in `tsconfig.json`
  bleibt; die Ereignisse werden strukturell typisiert, nicht über DOM-Typen.
