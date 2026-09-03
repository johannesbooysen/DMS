Dieser Abschnitt wird **von Hand gepflegt**. Er beschreibt, was sich nicht aus
dem Quelltext ableiten lässt: wer wofür zuständig ist, wo etwas liegt, was bei
einem Ausfall geschieht. Der Erzeuger stellt ihn dem technischen Teil voran.

> **Noch nicht vollständig.** Die mit „⬜ offen" gekennzeichneten Punkte sind
> vor der ersten Betriebsprüfung auszufüllen. Sie stehen hier ausgewiesen,
> statt zu fehlen — eine Verfahrensdokumentation mit einer benannten Lücke ist
> brauchbar, eine mit einer verschwiegenen nicht.

### Gegenstand

Das System ist ein Dokumentenmanagementsystem für die Immobilienverwaltung. Es
nimmt Eingangsrechnungen und zugehörigen Schriftverkehr auf, führt sie durch
einen konfigurierten Freigabe- und Kontierungsablauf, bereitet die Zahlung vor
und bewahrt die Belege auf.

**Aufzeichnungspflichtige Unterlagen** im Sinne der GoBD sind die
Eingangsrechnungen (`dokument` mit `belegart = 'rechnung'`), ihre Kontierung
(`kontierung`), die Freigabeentscheidungen (`stempel_ereignis`) und die
Zahlungsanweisungen. Alles Weitere — Vorschaubilder, Seitentexte,
Extraktionsergebnisse — sind Hilfsmittel und werden bei Bedarf neu erzeugt.

### Zuständigkeiten

| Rolle | Aufgabe | Wer |
|---|---|---|
| Verfahrensverantwortung | gibt die Verfahrensdokumentation frei, entscheidet über Ablaufänderungen | ⬜ offen |
| Systembetreuung | Betrieb, Sicherung, Wiederherstellung, Zugriffsverwaltung | ⬜ offen |
| Datenschutz | Löschanträge, Einschränkungen, Verzeichnis der Verarbeitungstätigkeiten | ⬜ offen |
| Fachliche Prüfung | sachliche und rechnerische Richtigkeit, Kontierung | siehe Rollen im System (§17 des Konzepts) |

Die fachlichen Rollen stehen nicht hier, sondern in den Stammdaten
(`rolle`, `benutzer_rolle_objekt`, `objekt_zustaendigkeit`) — dort sind sie
datiert und nachvollziehbar, hier wären sie eine zweite Wahrheit.

### Aufbewahrungsort

| Was | Wo | Schutz |
|---|---|---|
| Belegdateien (Original) | S3-kompatibler Objektspeicher | Object Lock, Compliance-Modus |
| Datenbank | PostgreSQL | Rollen und Row Level Security |
| Freigegebene Verfahrensdokumentation | derselbe Objektspeicher, `verfahrensdoku/` | Hash in der Datenbank |

Konkreter Anbieter, Region und Auftragsverarbeitungsvertrag: ⬜ offen.

### Datensicherung und Wiederherstellung

**Verfahren.** `npm run sicherung` zieht ein Abbild der Datenbankschemata
`public` und `app` (`pg_dump`, Format `custom`) und legt daneben ein
**Manifest** mit den Zählwerten der tragenden Tabellen. Die Belegdateien
selbst werden hier *nicht* mitgesichert: Sie liegen im Objektspeicher mit
Object Lock im Compliance-Modus, und ein zweiter Satz Kopien wäre ein
zweiter Ort, an dem sie altern.

**Die Probe ist Teil des Verfahrens, nicht ein Zusatz.**
`npm run sicherung:pruefen -- <verzeichnis>` holt die Sicherung in eine
eigene, anschließend verworfene Datenbank zurück und prüft dort fünf Dinge:

1. Lief das Zurückholen fehlerfrei?
2. Sind alle Zeilen da? (gegen das Manifest)
3. Trägt die Hash-Kette der Stempelereignisse?
4. Greifen RLS, Policies und die append-only-Trigger noch?
5. Liegen die archivierten Dateien noch, und stimmen ihre Hashes?

Punkt 4 ist der Grund für das ganze Verfahren: `pg_restore` bringt Zeilen
zurück und sagt nichts darüber, ob die Schutzmechanismen daran hängen. Ein
System ohne RLS sieht im Betrieb völlig normal aus.

Findet die Probe nichts vor — etwa weil die Sicherung noch keine
Stempelereignisse enthält —, sagt sie das ausdrücklich, statt Entwarnung zu
geben.

**Turnus:** ⬜ offen — festzulegen. Empfohlen: tägliche Sicherung,
Probe monatlich und nach jeder Änderung an Schema oder Ablage.

**Aufbewahrung der Sicherungen:** ⬜ offen — Ort, Verschlüsselung,
Aufbewahrungsdauer.

**Letzte geprobte Wiederherstellung:** ⬜ offen — Datum und Ergebnis sind
hier zu führen. Eine Probe, die niemand notiert, hat im Prüfungsfall nicht
stattgefunden.

### Änderungen am Verfahren

Änderungen am Ablauf sind Stammdaten, keine Programmierung: Stufenfolgen,
Stempeltypen, Betragsgrenzen und Zuständigkeiten stehen in
`prozessdefinition` / `prozessstufe` und werden **versioniert** — eine
laufende Akte behält die Fassung, unter der sie begonnen wurde
(`dokument_lauf.definition_version`).

Änderungen am Programm gehen über das Versionsverwaltungssystem; jede
Änderung am Datenmodell ist eine eigene Migrationsdatei unter
`supabase/migrations/` und wird nie nachträglich verändert.

Nach einer Änderung, die das Verfahren berührt, ist eine neue Fassung dieser
Dokumentation freizugeben (`npm run verfahrensdoku` und
`npm run verfahrensdoku:freigeben`).

### Notfall und Vertretung

Vertretung im laufenden Betrieb ist im System abgebildet: Die Aufgabe wandert
über die Eskalation, die Rolle bleibt beim Vertretenen — eine Vertretung
überträgt **keine** Rechte.

Notfallzugriff bei Ausfall des einzigen Zuständigen: ⬜ offen (Konzept §24.10).
Vorgesehen ist ein protokollierter Zugriff ohne Rechteänderung.

### Bekannte Einschränkungen

Diese Punkte gehören in eine ehrliche Verfahrensdokumentation, weil ein Prüfer
sie ohnehin findet:

- **Die Objektsperre greift nur mit S3.** Läuft das System gegen ein
  Dateiverzeichnis, bleibt `archiv_eintrag.storage_object_lock_bis` leer. Der
  Schutz besteht dann allein aus der Hash-Kette: Eine Änderung fällt auf, wird
  aber nicht verhindert.
- **Belege, die vor der ersten Freigabe archiviert wurden**, tragen keine
  Fassung. Diese Lücke lässt sich nicht nachträglich schließen — sie wäre eine
  Behauptung über ein Verfahren, das damals nicht beschrieben war. Sichtbar
  über `app.archiv_ohne_verfahrensdoku()`.
- **Das Löschen nach Fristablauf ist nicht automatisiert.** Die
  Kandidatenliste steht (`app.loeschkandidaten`), die Ausführung ist bewusst
  eine eigene Handlung.
