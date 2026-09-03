# Verfahrensdokumentation

> **Erzeugt aus dem Repository.** Nicht von Hand bearbeiten —
> `npm run verfahrensdoku` schreibt diese Datei neu. Der organisatorische
> Teil steht in [verfahrensdoku-organisation.md](verfahrensdoku-organisation.md)
> und wird von Hand gepflegt.
>
> Diese Datei beschreibt den **Stand des Quelltexts**. Verbindlich ist die
> jeweils *freigegebene* Fassung: `npm run verfahrensdoku:freigeben` legt
> eine Kopie mit Hash in der Ablage ab und hält in der Tabelle
> `verfahrensdokumentation` fest, ab wann sie gilt. Jeder archivierte Beleg
> trägt die Fassung, die bei seiner Archivierung galt
> (`archiv_eintrag.verfahrensdoku_version`).

## 1. Organisatorischer Teil

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

⬜ offen — Sicherungsverfahren, Aufbewahrung der Sicherungen, **Zeitpunkt des
letzten geprobten Restore**.

Dieser Punkt ist der wichtigste offene: Ein Archiv ohne getesteten Restore ist
kein Archiv, sondern eine Hoffnung. Er steht auch im Konzept als §24.7.

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

## 2. Das Datenmodell

71 Tabellen. Sie sind der Gegenstand der Aufbewahrung — was
hier nicht steht, wird auch nicht aufbewahrt.

| Tabelle | Angelegt in |
|---|---|
| `mandant` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `benutzer` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `gruppe` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `gruppe_mitglied` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `spezialgebiet` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `kontenrahmen` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `umlageschluessel` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `ordnungsgruppe` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `konto` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `belegmerkmal` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `zahlungsweg` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `objekt` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `objekt_zustaendigkeit` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `spezialgebiet_zustaendigkeit` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `kreditor` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `kreditor_bankverbindung` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `vertrag` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `prozessdefinition` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `prozessstufe` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `prozess_override` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `stempeltyp` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `stempel_recht` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `vorgang` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `dokument` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `dokument_datei` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `dokument_seite` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `dokument_merkmal` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `extraktion_feld` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `rechnung_fakten` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `dokument_beziehung` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `dokument_lauf` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `aufgabe` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `stempel_ereignis` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `klaerung` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `zuweisung_ereignis` | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `einheit` | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `person` | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `person_bezug` | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `kontierung` | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `kontierung_35a` | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `rolle` | [`20260830100000_rollen.sql`](../supabase/migrations/20260830100000_rollen.sql) |
| `rolle_recht` | [`20260830100000_rollen.sql`](../supabase/migrations/20260830100000_rollen.sql) |
| `benutzer_rolle_objekt` | [`20260830100000_rollen.sql`](../supabase/migrations/20260830100000_rollen.sql) |
| `prozessknoten` | [`20260830120000_prozessknoten.sql`](../supabase/migrations/20260830120000_prozessknoten.sql) |
| `prozessstufe_stempeltyp` | [`20260830130000_stufe_stempeltyp.sql`](../supabase/migrations/20260830130000_stufe_stempeltyp.sql) |
| `prozessdefinition_ereignis` | [`20260831100000_prozess_entwurf.sql`](../supabase/migrations/20260831100000_prozess_entwurf.sql) |
| `delegation` | [`20260831110000_delegation.sql`](../supabase/migrations/20260831110000_delegation.sql) |
| `plausibilitaet_befund` | [`20260831120000_plausibilitaet.sql`](../supabase/migrations/20260831120000_plausibilitaet.sql) |
| `zuordnungs_merkmal` | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `kontierungs_muster` | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `korrektur_ereignis` | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `sitzung` | [`20260831180000_anmeldung.sql`](../supabase/migrations/20260831180000_anmeldung.sql) |
| `anmelde_ereignis` | [`20260831180000_anmeldung.sql`](../supabase/migrations/20260831180000_anmeldung.sql) |
| `zahlung` | [`20260831190000_zahlung.sql`](../supabase/migrations/20260831190000_zahlung.sql) |
| `aufbewahrungsfrist` | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `archiv_eintrag` | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `einschraenkung` | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `einsicht_gewaehrung` | [`20260831220000_einsicht.sql`](../supabase/migrations/20260831220000_einsicht.sql) |
| `zugriff_protokoll` | [`20260831220000_einsicht.sql`](../supabase/migrations/20260831220000_einsicht.sql) |
| `wartecontainer` | [`20260831230000_nebenlauf.sql`](../supabase/migrations/20260831230000_nebenlauf.sql) |
| `bauteil` | [`20260831230000_nebenlauf.sql`](../supabase/migrations/20260831230000_nebenlauf.sql) |
| `stapel` | [`20260831240000_stapel.sql`](../supabase/migrations/20260831240000_stapel.sql) |
| `stapel_seite` | [`20260831240000_stapel.sql`](../supabase/migrations/20260831240000_stapel.sql) |
| `vorlage` | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `ausgang` | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `verarbeitungsfehler` | [`20260901100000_fehlerkorb.sql`](../supabase/migrations/20260901100000_fehlerkorb.sql) |
| `dokument_layer` | [`20260901120000_layer.sql`](../supabase/migrations/20260901120000_layer.sql) |
| `eingangsquelle` | [`20260901160000_eingangsquelle.sql`](../supabase/migrations/20260901160000_eingangsquelle.sql) |
| `eingang_geholt` | [`20260901160000_eingangsquelle.sql`](../supabase/migrations/20260901160000_eingangsquelle.sql) |
| `verfahrensdokumentation` | [`20260902140000_verfahrensdoku.sql`](../supabase/migrations/20260902140000_verfahrensdoku.sql) |
| `schriftverkehr_fakten` | [`20260902180000_schriftverkehr.sql`](../supabase/migrations/20260902180000_schriftverkehr.sql) |

## 3. Unveränderlichkeit: die Trigger

Diese Regeln wirken in der Datenbank und damit unabhängig davon, ob die
Anwendung sich daran hält. Eine Regel, die nur im Anwendungscode stünde, wäre
eine Absichtserklärung — hier ist sie eine Sperre.

| Trigger | Auf | Wann | Quelle |
|---|---|---|---|
| `stempel_ereignis_kette` | `stempel_ereignis` | before insert | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `stempel_ereignis_unveraenderlich` | `stempel_ereignis` | before update or delete | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `zuweisung_ereignis_unveraenderlich` | `zuweisung_ereignis` | before update or delete | [`20260828100000_kern.sql`](../supabase/migrations/20260828100000_kern.sql) |
| `kontierung_umlageflag` | `kontierung` | after insert or update or delete | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `prozessdefinition_ereignis_unveraenderlich` | `prozessdefinition_ereignis` | before update or delete | [`20260831100000_prozess_entwurf.sql`](../supabase/migrations/20260831100000_prozess_entwurf.sql) |
| `korrektur_ereignis_unveraenderlich` | `korrektur_ereignis` | before update or delete | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `stempel_ereignis_freigabe_hash` | `stempel_ereignis` | before insert | [`20260831190000_zahlung.sql`](../supabase/migrations/20260831190000_zahlung.sql) |
| `archiv_eintrag_unveraenderlich` | `archiv_eintrag` | before update or delete | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `einschraenkung_spiegel` | `einschraenkung` | after insert or update or delete | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `dokument_archiv_schutz` | `dokument` | before update or delete | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `kontierung_archiv_schutz` | `kontierung` | before insert or update or delete | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `rechnung_fakten_archiv_schutz` | `rechnung_fakten` | before insert or update or delete | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `zugriff_protokoll_unveraenderlich` | `zugriff_protokoll` | before update or delete | [`20260831220000_einsicht.sql`](../supabase/migrations/20260831220000_einsicht.sql) |
| `mandant_vorlagen` | `mandant` | after insert | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `dokument_layer_unveraenderlich` | `dokument_layer` | before update | [`20260901120000_layer.sql`](../supabase/migrations/20260901120000_layer.sql) |
| `stempel_ereignis_layer` | `stempel_ereignis` | after insert | [`20260901120000_layer.sql`](../supabase/migrations/20260901120000_layer.sql) |
| `verfahrensdoku_unveraenderlich` | `verfahrensdokumentation` | before update or delete | [`20260902140000_verfahrensdoku.sql`](../supabase/migrations/20260902140000_verfahrensdoku.sql) |
| `schriftverkehr_fakten_archiv_schutz` | `schriftverkehr_fakten` | before insert or update or delete | [`20260902180000_schriftverkehr.sql`](../supabase/migrations/20260902180000_schriftverkehr.sql) |

## 4. Zugriffsschutz: die Policies

Row Level Security ist in diesem System die Sicherheitsgrenze, nicht ein
Feature. Jede Abfrage läuft unter der Rolle `dms_app` — nicht als
Tabelleneigentümer —, sodass die Policies nicht umgangen werden können.

Tabellen mit Policies (67): `anmelde_ereignis`, `archiv_eintrag`, `aufbewahrungsfrist`, `aufgabe`, `ausgang`, `bauteil`, `belegmerkmal`, `benutzer`, `benutzer_rolle_objekt`, `delegation`, `dokument`, `dokument_beziehung`, `dokument_datei`, `dokument_lauf`, `dokument_merkmal`, `dokument_seite`, `einheit`, `einschraenkung`, `einsicht_gewaehrung`, `extraktion_feld`, `gruppe`, `gruppe_mitglied`, `klaerung`, `kontenrahmen`, `kontierung`, `kontierung_35a`, `kontierungs_muster`, `konto`, `korrektur_ereignis`, `kreditor`, `kreditor_bankverbindung`, `mandant`, `objekt`, `objekt_zustaendigkeit`, `ordnungsgruppe`, `person`, `person_bezug`, `plausibilitaet_befund`, `prozess_override`, `prozessdefinition`, `prozessdefinition_ereignis`, `prozessknoten`, `prozessstufe`, `prozessstufe_stempeltyp`, `rechnung_fakten`, `rolle`, `rolle_recht`, `schriftverkehr_fakten`, `sitzung`, `spezialgebiet`, `spezialgebiet_zustaendigkeit`, `stapel`, `stapel_seite`, `stempel_ereignis`, `stempel_recht`, `stempeltyp`, `umlageschluessel`, `verfahrensdokumentation`, `vertrag`, `vorgang`, `vorlage`, `wartecontainer`, `zahlung`, `zahlungsweg`, `zugriff_protokoll`, `zuordnungs_merkmal`, `zuweisung_ereignis`

| Policy | Tabelle | Art | Quelle |
|---|---|---|---|
| `mandant_sicht` | `mandant` | select | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `benutzer_sicht` | `benutzer` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `gruppe_sicht` | `gruppe` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `gruppe_mitglied_sicht` | `gruppe_mitglied` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `spezialgebiet_sicht` | `spezialgebiet` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `spezialgebiet_zustaendigkeit_sicht` | `spezialgebiet_zustaendigkeit` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `kontenrahmen_sicht` | `kontenrahmen` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `konto_sicht` | `konto` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `umlageschluessel_sicht` | `umlageschluessel` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `ordnungsgruppe_sicht` | `ordnungsgruppe` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `belegmerkmal_sicht` | `belegmerkmal` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `zahlungsweg_sicht` | `zahlungsweg` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `objekt_sicht` | `objekt` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `objekt_zustaendigkeit_sicht` | `objekt_zustaendigkeit` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `kreditor_sicht` | `kreditor` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `kreditor_bankverbindung_sicht` | `kreditor_bankverbindung` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `vertrag_sicht` | `vertrag` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `prozessdefinition_sicht` | `prozessdefinition` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `prozessstufe_sicht` | `prozessstufe` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `prozess_override_sicht` | `prozess_override` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `stempeltyp_sicht` | `stempeltyp` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `stempel_recht_sicht` | `stempel_recht` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `vorgang_sicht` | `vorgang` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `dokument_sicht` | `dokument` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `dokument_datei_sicht` | `dokument_datei` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `dokument_seite_sicht` | `dokument_seite` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `dokument_merkmal_sicht` | `dokument_merkmal` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `extraktion_feld_sicht` | `extraktion_feld` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `rechnung_fakten_sicht` | `rechnung_fakten` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `dokument_beziehung_sicht` | `dokument_beziehung` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `dokument_lauf_sicht` | `dokument_lauf` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `klaerung_sicht` | `klaerung` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `zuweisung_ereignis_sicht` | `zuweisung_ereignis` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `aufgabe_sicht` | `aufgabe` | all | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `stempel_ereignis_lesen` | `stempel_ereignis` | select | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `stempel_ereignis_anlegen` | `stempel_ereignis` | insert | [`20260828100100_rls.sql`](../supabase/migrations/20260828100100_rls.sql) |
| `einheit_sicht` | `einheit` | all | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `person_sicht` | `person` | all | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `person_bezug_sicht` | `person_bezug` | all | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `kontierung_sicht` | `kontierung` | all | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `kontierung_35a_sicht` | `kontierung_35a` | all | [`20260828120000_einheit_person_kontierung.sql`](../supabase/migrations/20260828120000_einheit_person_kontierung.sql) |
| `rolle_sicht` | `rolle` | all | [`20260830100000_rollen.sql`](../supabase/migrations/20260830100000_rollen.sql) |
| `rolle_recht_sicht` | `rolle_recht` | all | [`20260830100000_rollen.sql`](../supabase/migrations/20260830100000_rollen.sql) |
| `benutzer_rolle_objekt_sicht` | `benutzer_rolle_objekt` | all | [`20260830100000_rollen.sql`](../supabase/migrations/20260830100000_rollen.sql) |
| `prozessknoten_sicht` | `prozessknoten` | all | [`20260830120000_prozessknoten.sql`](../supabase/migrations/20260830120000_prozessknoten.sql) |
| `prozessstufe_stempeltyp_sicht` | `prozessstufe_stempeltyp` | all | [`20260830130000_stufe_stempeltyp.sql`](../supabase/migrations/20260830130000_stufe_stempeltyp.sql) |
| `prozessdefinition_ereignis_lesen` | `prozessdefinition_ereignis` | select | [`20260831100000_prozess_entwurf.sql`](../supabase/migrations/20260831100000_prozess_entwurf.sql) |
| `prozessdefinition_ereignis_anlegen` | `prozessdefinition_ereignis` | insert | [`20260831100000_prozess_entwurf.sql`](../supabase/migrations/20260831100000_prozess_entwurf.sql) |
| `delegation_sicht` | `delegation` | select | [`20260831110000_delegation.sql`](../supabase/migrations/20260831110000_delegation.sql) |
| `delegation_anlegen` | `delegation` | insert | [`20260831110000_delegation.sql`](../supabase/migrations/20260831110000_delegation.sql) |
| `delegation_widerrufen` | `delegation` | update | [`20260831110000_delegation.sql`](../supabase/migrations/20260831110000_delegation.sql) |
| `plausibilitaet_befund_sicht` | `plausibilitaet_befund` | all | [`20260831120000_plausibilitaet.sql`](../supabase/migrations/20260831120000_plausibilitaet.sql) |
| `zuordnungs_merkmal_sicht` | `zuordnungs_merkmal` | all | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `kontierungs_muster_sicht` | `kontierungs_muster` | all | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `korrektur_ereignis_lesen` | `korrektur_ereignis` | select | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `korrektur_ereignis_anlegen` | `korrektur_ereignis` | insert | [`20260831130000_lernspeicher.sql`](../supabase/migrations/20260831130000_lernspeicher.sql) |
| `dokument_sicht` | `dokument` | all | [`20260831140000_zuordnungssicht.sql`](../supabase/migrations/20260831140000_zuordnungssicht.sql) |
| `dokument_lesen` | `dokument` | select | [`20260831160000_dokument_policies_trennen.sql`](../supabase/migrations/20260831160000_dokument_policies_trennen.sql) |
| `dokument_anlegen` | `dokument` | insert | [`20260831160000_dokument_policies_trennen.sql`](../supabase/migrations/20260831160000_dokument_policies_trennen.sql) |
| `dokument_aendern` | `dokument` | update | [`20260831160000_dokument_policies_trennen.sql`](../supabase/migrations/20260831160000_dokument_policies_trennen.sql) |
| `dokument_loeschen` | `dokument` | delete | [`20260831160000_dokument_policies_trennen.sql`](../supabase/migrations/20260831160000_dokument_policies_trennen.sql) |
| `sitzung_eigene` | `sitzung` | select | [`20260831180000_anmeldung.sql`](../supabase/migrations/20260831180000_anmeldung.sql) |
| `anmelde_ereignis_eigene` | `anmelde_ereignis` | select | [`20260831180000_anmeldung.sql`](../supabase/migrations/20260831180000_anmeldung.sql) |
| `zahlung_sicht` | `zahlung` | all | [`20260831190000_zahlung.sql`](../supabase/migrations/20260831190000_zahlung.sql) |
| `dokument_lesen` | `dokument` | select | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `aufbewahrungsfrist_sicht` | `aufbewahrungsfrist` | all | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `archiv_eintrag_sicht` | `archiv_eintrag` | select | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `einschraenkung_sicht` | `einschraenkung` | select | [`20260831200000_archiv.sql`](../supabase/migrations/20260831200000_archiv.sql) |
| `anmelde_ereignis_eigene` | `anmelde_ereignis` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `aufbewahrungsfrist_sicht` | `aufbewahrungsfrist` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `aufgabe_sicht` | `aufgabe` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `belegmerkmal_sicht` | `belegmerkmal` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `benutzer_sicht` | `benutzer` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `benutzer_rolle_objekt_sicht` | `benutzer_rolle_objekt` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `delegation_anlegen` | `delegation` | insert | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `delegation_sicht` | `delegation` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `delegation_widerrufen` | `delegation` | update | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `dokument_aendern` | `dokument` | update | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `dokument_anlegen` | `dokument` | insert | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `dokument_lesen` | `dokument` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `dokument_loeschen` | `dokument` | delete | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `einheit_sicht` | `einheit` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `einschraenkung_sicht` | `einschraenkung` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `gruppe_sicht` | `gruppe` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `gruppe_mitglied_sicht` | `gruppe_mitglied` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `kontenrahmen_sicht` | `kontenrahmen` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `kontierungs_muster_sicht` | `kontierungs_muster` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `konto_sicht` | `konto` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `korrektur_ereignis_anlegen` | `korrektur_ereignis` | insert | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `kreditor_sicht` | `kreditor` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `kreditor_bankverbindung_sicht` | `kreditor_bankverbindung` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `mandant_sicht` | `mandant` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `objekt_sicht` | `objekt` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `objekt_zustaendigkeit_sicht` | `objekt_zustaendigkeit` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `ordnungsgruppe_sicht` | `ordnungsgruppe` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `person_sicht` | `person` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `person_bezug_sicht` | `person_bezug` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozess_override_sicht` | `prozess_override` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozessdefinition_sicht` | `prozessdefinition` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozessdefinition_ereignis_anlegen` | `prozessdefinition_ereignis` | insert | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozessdefinition_ereignis_lesen` | `prozessdefinition_ereignis` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozessknoten_sicht` | `prozessknoten` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozessstufe_sicht` | `prozessstufe` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `prozessstufe_stempeltyp_sicht` | `prozessstufe_stempeltyp` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `rolle_sicht` | `rolle` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `rolle_recht_sicht` | `rolle_recht` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `sitzung_eigene` | `sitzung` | select | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `spezialgebiet_sicht` | `spezialgebiet` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `spezialgebiet_zustaendigkeit_sicht` | `spezialgebiet_zustaendigkeit` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `stempel_ereignis_anlegen` | `stempel_ereignis` | insert | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `stempel_recht_sicht` | `stempel_recht` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `stempeltyp_sicht` | `stempeltyp` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `umlageschluessel_sicht` | `umlageschluessel` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `vertrag_sicht` | `vertrag` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `vorgang_sicht` | `vorgang` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `zahlungsweg_sicht` | `zahlungsweg` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `zuordnungs_merkmal_sicht` | `zuordnungs_merkmal` | all | [`20260831210000_policies_initplan.sql`](../supabase/migrations/20260831210000_policies_initplan.sql) |
| `einsicht_gewaehrung_sicht` | `einsicht_gewaehrung` | all | [`20260831220000_einsicht.sql`](../supabase/migrations/20260831220000_einsicht.sql) |
| `zugriff_protokoll_lesen` | `zugriff_protokoll` | select | [`20260831220000_einsicht.sql`](../supabase/migrations/20260831220000_einsicht.sql) |
| `wartecontainer_sicht` | `wartecontainer` | all | [`20260831230000_nebenlauf.sql`](../supabase/migrations/20260831230000_nebenlauf.sql) |
| `bauteil_sicht` | `bauteil` | all | [`20260831230000_nebenlauf.sql`](../supabase/migrations/20260831230000_nebenlauf.sql) |
| `stapel_sicht` | `stapel` | all | [`20260831240000_stapel.sql`](../supabase/migrations/20260831240000_stapel.sql) |
| `stapel_seite_sicht` | `stapel_seite` | all | [`20260831240000_stapel.sql`](../supabase/migrations/20260831240000_stapel.sql) |
| `vorlage_sicht` | `vorlage` | all | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `ausgang_sicht` | `ausgang` | select | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `ausgang_anlegen` | `ausgang` | insert | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `ausgang_wiederholen` | `ausgang` | update | [`20260831250000_postausgang.sql`](../supabase/migrations/20260831250000_postausgang.sql) |
| `verfahrensdoku_lesen` | `verfahrensdokumentation` | select | [`20260902140000_verfahrensdoku.sql`](../supabase/migrations/20260902140000_verfahrensdoku.sql) |
| `verfahrensdoku_anlegen` | `verfahrensdokumentation` | insert | [`20260902140000_verfahrensdoku.sql`](../supabase/migrations/20260902140000_verfahrensdoku.sql) |
| `schriftverkehr_fakten_sicht` | `schriftverkehr_fakten` | all | [`20260902180000_schriftverkehr.sql`](../supabase/migrations/20260902180000_schriftverkehr.sql) |

## 5. Ein- und Ausgang

Je Richtung gibt es genau **eine** Schleuse. Jeder Beleg — hochgeladen, aus
einem überwachten Ordner geholt, aus einem Postfach abgerufen oder aus einem
Stapel getrennt — geht durch `dokumentAufnehmen`, mit derselben Hash-,
Dubletten- und Warteschlangenbehandlung. Nichts verlässt das Haus außerhalb
des Ausgangsbuchs (`postAnlegen`).

| Weg | Rolle | Modul |
|---|---|---|
| Eingang | nutzt sie | [`src/app/lib/posteingang-aktionen.ts`](../src/app/lib/posteingang-aktionen.ts) |
| Ausgang | nutzt sie | [`src/app/lib/zahlungsmittel.ts`](../src/app/lib/zahlungsmittel.ts) |
| Eingang | nutzt sie | [`src/eingang/index.ts`](../src/eingang/index.ts) |
| Ausgang | nutzt sie | [`src/einsicht/index.ts`](../src/einsicht/index.ts) |
| Eingang | Schleuse | [`src/ingest/aufnehmen.ts`](../src/ingest/aufnehmen.ts) |
| Ausgang | Schleuse | [`src/postausgang/index.ts`](../src/postausgang/index.ts) |
| Eingang | nutzt sie | [`src/stapel/index.ts`](../src/stapel/index.ts) |

## 6. Nachweis der Wirksamkeit

Für die GoBD genügt es nicht, Kontrollen zu beschreiben — sie müssen wirksam
sein. Die folgenden Zusicherungen werden bei jedem Testlauf geprüft. Der
Testname *ist* die Zusicherung; verschwindet sie hier, ist sie nicht mehr
belegt.

### [`tests/ablage-s3.test.ts`](../tests/ablage-s3.test.ts)

- erkennt die S3-Ablage als sperrbar
- erkennt die Dateisystem-Ablage als nicht sperrbar
- legt eine Datei ab und liest sie unveraendert zurueck
- meldet eine fehlende Datei als Fehler
- meldet ohne Sperre schlicht keine
- sperrt bis zum Datum und sagt das auch
- bewahrt das Original, wenn jemand darueber schreibt
- gibt die Kennung der Fassung heraus, die sie gesperrt hat
- laesst die Frist verlaengern
- laesst die Frist nicht verkuerzen
- ohne Object Lock am Eimer schlaegt die Sperre fehl

### [`tests/anmeldung.test.ts`](../tests/anmeldung.test.ts)

- loest den eigenen Token auf
- legt den Token nicht im Klartext ab
- kennt einen erfundenen Token nicht
- kennt den leeren Token nicht
- endet mit der Abmeldung
- protokolliert Anmeldung und Abmeldung
- nach Ablauf -- und wird dabei beendet, nicht nur uebergangen
- nach zu langer Untaetigkeit
- sofort, wenn der Benutzer gesperrt wird
- haelt sich bei jeder Benutzung frisch
- laesst sich fuer einen Benutzer geschlossen widerrufen
- ein gesperrter Benutzer
- eine Kennung, zu der es niemanden gibt
- bindet beim ersten Mal ueber die E-Mail-Adresse
- geht danach ueber die Kennung, nicht mehr ueber die Adresse
- legt niemanden an, den es nicht gibt
- verdraengt eine bestehende Identitaet nicht ueber dieselbe Adresse
- bindet keinen gesperrten Benutzer
- vergleicht die Adresse ohne Rücksicht auf Gross- und Kleinschreibung
- merkt sich den Zeitpunkt der Anmeldung
- kommt unveraendert zurueck
- faellt auf, wenn jemand daran dreht
- faellt auf, wenn die Signatur fehlt
- vertraegt fehlende und unsinnige Werte
- laesst eigene Pfade durch
- weist fremde Adressen ab
- leitet nicht auf die Anmeldung zurueck
- nimmt Entra, sobald es eingerichtet ist
- bricht ab, wenn gar nichts eingerichtet ist
- nimmt die Entwicklungsanmeldung nur, wenn sie ausdruecklich eingeschaltet ist
- nimmt sie im Betrieb auch dann nicht, wenn die Variable gesetzt ist
- gibt einen Zustand mit eigenem state aus
- weist eine Antwort mit fremdem state ab
- liefert bei passendem state die gewaehlte Identitaet
- haelt einen vergeblichen Versuch ohne Benutzerbezug fest
- zeigt niemandem die Sitzungen eines anderen
- laesst niemanden eine Sitzung von Hand anlegen

### [`tests/archiv.test.ts`](../tests/archiv.test.ts)

- rechnet ab dem Ende des Jahres, nicht ab dem Belegdatum
- nimmt zehn Jahre, wenn nichts hinterlegt ist
- nimmt die hinterlegte Frist der Belegart
- faellt auf das Eingangsjahr zurueck, wenn kein Wirtschaftsjahr steht
- haelt den Hash der Datei fest
- setzt den Status auf archiviert
- laesst einen abgelehnten Beleg abgelehnt
- archiviert nicht zweimal
- traegt ohne Object Lock kein Datum ein
- laesst den Betrag nicht mehr aendern
- laesst die Kontierung nicht mehr aendern
- laesst keine Kontierungszeile mehr hinzufuegen
- laesst den Beleg nicht umgruppieren
- laesst ihn nicht loeschen
- laesst den Archiveintrag selbst nicht aendern
- setzt den Beleg auf storniert und verlangt eine Begruendung
- verkettet die Ersatzrechnung mit dem Ursprungsbeleg
- loescht nicht, sondern schraenkt bis zum Fristablauf ein
- entzieht die Leserechte -- auch dem Zustaendigen
- laesst den Nachweis stehen, dass der Antrag bearbeitet wurde
- zeigt einen Loeschkandidaten erst nach Fristablauf
- haelt ihn trotz Fristablauf, wenn eine Loeschsperre steht
- zeigt einem fremden Mandanten keine Loeschkandidaten
- zeigt einem fremden Mandanten die Einschraenkung nicht
- sammelt Beleg, Kontierung und Stempelhistorie
- benennt Belege ohne Originaldatei, statt sie zu verschweigen
- schreibt ein Manifest, mit dem sich die Akte ohne uns pruefen laesst
- legt neben das Original eine gestempelte Lesefassung
- benennt einen Beleg ohne Lesefassung, statt ihn zu uebergehen
- stimmt: der Hash im Manifest passt zur geschriebenen Datei
- schreibt Datumsangaben als Datum, nicht als Zeitpunkt
- schreibt Zeitstempel als gueltiges ISO-8601
- schreibt ein Manifest, das "sha256sum -c" ohne Warnung liest
- gibt einem nicht zustaendigen Kollegen eine leere Akte
- nimmt eingeschraenkte Belege nicht mit

### [`tests/aufbereitung.test.ts`](../tests/aufbereitung.test.ts)

- liest jede Seite einzeln
- liefert den Text der Seite
- haelt die Seitenmasse fest
- gibt zu jedem Textstueck eine Fundstelle mit Ursprung oben links
- erkennt einen Beleg mit Textlayer
- schickt einen Scan mit fast keinem Text in die OCR-Strecke
- haelt ein Dokument ohne Seiten nicht fuer lesbar
- erzeugt eine WebP-Datei in der gewuenschten Breite
- liefert bei groesserer Zielbreite auch mehr Daten
- erkennt eine reine XRechnung
- haelt ein PDF nicht dafuer
- schreibt Seitentext, Derivate und Seitenzahl
- macht den Seitentext volltextdurchsuchbar
- meldet bei einem Scan ohne Textlayer, dass OCR noetig ist
- legt die Derivate in der Ablage ab

### [`tests/auswertung.test.ts`](../tests/auswertung.test.ts)

- misst vom Eintritt in die Stufe bis zum beendenden Stempel
- rechnet den zweiten Stempel ab dem ersten, nicht ab dem Start
- zaehlt Klaerung und Rueckgabe nicht als Abschluss
- zaehlt verfallene Stempel nicht mit
- laesst ohne Angabe alles aelter als 90 Tage weg
- nimmt einen frischen Stempel in den Vorgabezeitraum
- rechnet den Verlust aus Brutto und Prozentsatz
- trennt zu spaet gezahlt von gar nicht gezahlt
- zaehlt eine rechtzeitige Zahlung nicht als Verlust
- zaehlt einen stornierten Beleg nicht
- zaehlt einen Beleg ohne Skontovereinbarung nicht
- haelt Summe und Einzelfaelle zusammen
- rechnet ab Eingang im Haus
- zaehlt einen Beleg in Klaerung als offen
- zaehlt einen abgeschlossenen Lauf nicht
- haelt sich an die Grenze
- zeigt einem fremden Mandanten keinen Skontoverlust
- zeigt einem fremden Mandanten keine Durchlaufzeit
- zeigt einem fremden Mandanten keinen offenen Beleg

### [`tests/belegliste.test.ts`](../tests/belegliste.test.ts)

- zeigt den eigenen Beleg
- bringt die Marken samt Farbe aus den Stammdaten mit
- sortiert das Neueste nach oben
- liefert einen Zeitstempel, den JavaScript lesen kann
- zeigt einen Beleg ohne Objekt -- gerade der braucht Aufmerksamkeit
- haelt das Limit ein
- laesst ein Objekt mit vielen frischen Belegen die anderen verdraengen
- zeigt die Belege des Objekts
- zeigt keine Belege eines anderen Objekts
- filtert nach Ampel
- filtert nach Ordnungsgruppe
- filtert nach Belegart
- nimmt Belege des letzten Tages mit
- laesst einen Beleg vor dem Zeitraum weg
- zaehlt dasselbe, was die Liste zeigt
- findet ein Wort im Belegtext
- liefert Seite und Auszug zur Fundstelle
- versteht eine Wortgruppe in Anfuehrungszeichen
- versteht den Ausschluss mit Minus
- scheitert nicht an unsinniger Eingabe
- zaehlt Volltexttreffer genauso
- zeigt einem fremden Mandanten nichts
- zeigt einem Kollegen ohne Zustaendigkeit nichts
- zeigt der mandantenweiten Buchhaltungsrolle alles
- oeffnet einen Spezialgebietsbeleg nur dem Spezialisten
- nimmt einen eingeschraenkten Beleg aus jeder Sicht
- erkennt einen leeren Filter als ungefiltert
- erkennt jeden gesetzten Filter
- taucht in der Liste auf, obwohl keine Aufgabe mehr offen ist

### [`tests/eingang.test.ts`](../tests/eingang.test.ts)

- nimmt eine abgelegte Rechnung auf
- holt dieselbe Datei nicht zweimal
- laesst eine Datei liegen, die noch geschrieben wird
- uebergeht Dateien, die keine Belege sein koennen
- verschiebt nach dem Aufnehmen, wenn ein Zielordner eingestellt ist
- laesst die Datei liegen, wenn kein Zielordner eingestellt ist
- haelt einen fehlenden Ordner in der Quelle fest, nicht im Log
- verlangt einen Pfad
- macht aus jedem Rechnungsanhang einen Beleg
- macht aus einer Mail ohne Anhang die Mail selbst
- nimmt die Ersatzkennung, wenn die Message-Id fehlt
- macht aus einem Signaturbild keinen Beleg
- gewinnt aus einer Mail lesbaren Text
- nimmt den Anhang auf und merkt sich die Nachricht
- fuehrt eine Nachricht ohne Anhang als Schriftverkehr, nicht als Rechnung
- macht aus dem Anhang trotzdem eine Rechnung
- macht den Mailtext bei der Aufbereitung durchsuchbar
- laesst eine kaputte Quelle die andere nicht aufhalten
- uebergeht eine abgeschaltete Quelle
- uebergeht eine Quelle, deren Einrichter gesperrt ist
- zaehlt nur, was wirklich hereinkam
- zeigt Doris die Quellen des fremden Mandanten nicht
- nimmt den Beleg im Mandanten der Quelle auf, nicht im Mandanten des Aufrufers
- reicht jedes Fundstueck durch denselben Eingang

### [`tests/einsicht.test.ts`](../tests/einsicht.test.ts)

- loest die Gewaehrung auf
- liegt in der Datenbank nur als Hash
- kennt einen erfundenen Token nicht
- kennt den leeren Token nicht
- liefert Datumsangaben, die ein Datum ergeben
- liefert nach gueltig_bis nichts mehr
- verlaengert sich nicht durch Benutzung
- gilt vor gueltig_von noch nicht
- endet mit dem Widerruf sofort
- laesst sich nicht zweimal widerrufen
- weist eine unsinnige Gueltigkeit ab
- zeigt den Beleg aus der Mietzeit
- zeigt den Beleg nach dem Auszug nicht
- zeigt dem Nachmieter nur seine Zeit
- zeigt keinen Beleg ohne umlagefaehige Zeile
- aendert sich mit den Daten, nicht mit einer Freigabe
- verweigert einem Mieter einen Umfang, der nicht zu ihm passt
- sieht das gewaehlte Wirtschaftsjahr
- sieht ein anderes Wirtschaftsjahr nicht
- braucht fuer den Umfang Vorgang einen Vorgang
- ein eingeschraenkter Beleg
- ein stornierter Beleg
- ein Beleg eines anderen Objekts
- laesst einen Beleg ausserhalb des Umfangs nicht durch
- antwortet nach dem Widerruf mit nein
- antwortet nach Ablauf mit nein
- liefert die Leseansicht, nicht die Miniatur
- liefert nichts fuer einen Beleg ausserhalb des Umfangs
- liefert nach dem Widerruf nichts mehr
- haelt jeden Abruf fest
- haelt auch den abgelehnten Versuch fest
- laesst sich nicht nachtraeglich aendern
- zaehlt die Zugriffe in der Uebersicht
- laesst niemanden Einsicht auf ein fremdes Objekt gewaehren
- zeigt einem fremden Mandanten die Gewaehrung nicht
- zeigt einem nicht zustaendigen Kollegen die Gewaehrung nicht
- laesst einen Fremden nicht widerrufen
- gibt standardmaessig nur Ansicht
- nimmt den Download nur, wenn er ausdruecklich dabeisteht
- setzt das Wasserzeichen als Vorgabe
- legt ohne Adresse nichts ins Ausgangsbuch
- legt mit Adresse einen fluechtigen Eintrag an, der den Link traegt
- legt keinen Eintrag an, wenn die Gewaehrung scheitert

### [`tests/engine.test.ts`](../tests/engine.test.ts)

- liest die Werte des Belegs fuer Bedingungen zusammen
- startet mit der ersten Stufe und weist sie dem Objektverantwortlichen zu
- ruecktdurch die Kette, ohne dass der Stempel ein Ziel nennt
- schreibt zu jedem Schritt ein Stempelereignis
- beendet den Lauf bei Ablehnung und setzt den Beleg auf abgelehnt
- haelt bei Klaerung an, ohne die Aufgabe zu schliessen
- laesst eine Stufe entfallen, statt sie stillschweigend zu ueberspringen
- oeffnet beide Stufen gleichzeitig und wartet auf die zweite
- nimmt den Dann-Zweig, wenn die Bedingung zutrifft
- nimmt den Sonst-Zweig, wenn sie nicht zutrifft
- meldet die Pflichtstufen, die noch keinen Stempel haben
- gibt frei, wenn jede Pflichtstufe erledigt ist
- zeigt die Kette, die sich fuer einen gedachten Beleg ergibt
- laesst eine Stufe aus, deren Betragsgrenze nicht greift
- veraendert dabei nichts

### [`tests/export.test.ts`](../tests/export.test.ts)

- gibt die Datei unveraendert heraus
- bleibt auch dann das Original, wenn geschwaerzt wurde
- zeichnet den Stempel auf den Beleg
- ersetzt Zeichen, die die Standardschrift nicht kennt
- nimmt keine Notiz mit
- haengt eine Seite an und schreibt den Stempel darauf
- nimmt die Masse der letzten Seite
- entfernt den Text darunter wirklich
- zwingt auch die Stempelvariante in den Bilderweg
- verweigert den Export, wenn keine Seitenbilder vorliegen
- traegt Empfaenger und Datum
- fehlt bei den internen Varianten
- gibt Doris keinen Export eines fremden Belegs
- sagt, dass es nichts auszugeben gibt

### [`tests/exportvarianten.test.ts`](../tests/exportvarianten.test.ts)

- traegt keinen einzigen Layer
- bleibt auch bei Schwaerzungen das Original
- bei jeder Variante ausser dem Archivoriginal
- auch bei der Variante, die Schwaerzungen gar nicht zeigt
- ohne Schwaerzung bleibt es beim Original mit gezeichneten Layern
- nimmt Stempel in alles ausser das Archivoriginal
- laesst eine interne Notiz nie nach draussen
- nimmt eine Schwaerzung unabhaengig von ihrer Sichtbarkeit
- laesst eine Hervorhebung nur ausdruecklich freigegeben hinaus
- nimmt in die Stempelvariante wirklich nur Stempel
- erkennt die vier aus dem Konzept
- weist alles andere ab

### [`tests/extraktion.test.ts`](../tests/extraktion.test.ts)

- liest alle Felder aus einer CrossIndustryInvoice
- setzt das Vertrauen per Definition auf 1
- liest auch das UBL-Format der XRechnung
- wandelt das knappe Datumsformat um
- erkennt eine reine XML-Rechnung ohne PDF-Huelle
- holt das XML aus dem PDF heraus
- findet in einem gewoehnlichen PDF keines
- nimmt das Minimum ueber die Pflichtfelder, nicht den Durchschnitt
- gibt kein Vertrauen an, wenn ein Pflichtfeld fehlt
- faerbt die Ampel nach dem Vertrauen
- liest Felder mit Vertrauenswert
- verweigert einem Modell die volle Sicherheit
- ueberspringt Felder ausserhalb der Liste
- ueberspringt ein Datum in falschem Format, statt es zu erfinden
- kommt mit Geschwaetz um das JSON herum zurecht
- gibt bei unlesbarer Antwort nichts zurueck
- schreibt die Felder und fuellt die Rechnungsdaten
- ordnet den Kreditor ueber die USt-ID zu
- setzt die Ampel auf rot, wenn niemand etwas erkennt
- ueberschreibt einen bestaetigten Wert nicht
- erkennt die Felder einer ZUGFeRD-Rechnung im ganzen Durchlauf
- liest das deutsche Format
- liest das Format, um das der Prompt bittet
- erkennt eine Tausendergruppe an den drei Stellen dahinter
- kommt mit Waehrungszeichen und Leerraum zurecht
- liest Zahlen ohne Trennzeichen
- gibt bei Unlesbarem nichts zurueck, statt zu raten

### [`tests/fehlerkorb-queue.test.ts`](../tests/fehlerkorb-queue.test.ts)

- reicht Nutzlast, Grund und Herkunft weiter

### [`tests/fehlerkorb.test.ts`](../tests/fehlerkorb.test.ts)

- haelt Grund, Warteschlange und Versuche fest
- meldet denselben Vorgang nicht zweimal offen
- kuerzt einen ausufernden Grund
- meldet nichts zu einer verschwundenen Quelle
- verlangt genau eine Quelle
- zeigt Doris den Korb des fremden Mandanten nicht
- laesst Doris einen fremden Eintrag nicht erledigen
- zeigt einen Beleg ohne Objekt jedem im Mandanten
- wiederholen reiht neu ein und schliesst den Eintrag
- manuell macht den Beleg laufend
- verwerfen storniert, statt zu loeschen
- verlangt fuer das Verwerfen eine Begruendung
- erledigt einen Eintrag nicht zweimal
- findet einen Beleg, den niemand gemeldet hat
- schweigt, solange der Beleg im Korb steht
- schweigt bei einem frisch eingegangenen Beleg
- zeigt Doris nichts aus dem fremden Mandanten
- meldet einen Beleg nach dem Erledigen nicht wieder als Haenger
- landet mit eigener Quelle im Korb
- laesst sich nicht von Hand uebernehmen
- wird beim Verwerfen verworfen, nicht storniert
- reiht ein und laesst den Beleg in Aufbereitung
- reiht einen Beleg nicht ein, der schon weiter ist
- laesst Doris keinen fremden Beleg einreihen

### [`tests/ingest.test.ts`](../tests/ingest.test.ts)

- legt Dokument, Datei und Lauf an
- legt das Original in der Ablage ab
- bildet den Hash ueber die Bytes der Datei
- erkennt dieselbe Datei am Inhaltshash und startet keinen Lauf
- verkettet die Dublette mit dem Original
- erkennt dasselbe Papier an Kreditor, Rechnungsnummer und Betrag
- haelt gleichen Kreditor und gleichen Betrag ohne Rechnungsnummer nicht fuer eine Dublette
- sucht nicht ueber Mandantengrenzen hinweg

### [`tests/kette.test.ts`](../tests/kette.test.ts)

- reiht die Aufbereitung ein
- reiht fuer eine Dublette nichts ein
- schreibt Auftrag und Dokument gemeinsam fest
- fuehrt vom Eingang ueber die Aufbereitung zur offenen Aufgabe

### [`tests/konfiguration.test.ts`](../tests/konfiguration.test.ts)

- laesst die Geschaeftsleitung einen Entwurf anlegen
- verweigert es dem Objektbearbeiter
- verweigert es der Buchhaltung
- kopiert Stufen und Baum vollstaendig
- gibt der Kopie eigene Stufen -- sonst aendert sie laufende Belege mit
- uebernimmt auch die erlaubten Stempel je Stufe
- laesst keinen zweiten Entwurf zu derselben Belegart zu
- verweigert das Bearbeiten der aktiven Fassung
- haengt einen Baustein an und zaehlt ihn mit
- vertauscht zwei Geschwister
- bewegt den obersten Baustein nicht weiter nach oben
- laesst die Wurzel weder bewegen noch entfernen
- weist eine Bedingung ausserhalb der Weissliste ab
- schaltet einen gueltigen Entwurf scharf und loest die alte Fassung ab
- weigert sich bei einem ungueltigen Ablauf
- meldet die Befunde vor dem Aktivieren
- protokolliert, wer aktiviert hat
- laesst das Protokoll nicht nachtraeglich aendern
- zeigt die Kette fuer einen gedachten Beleg
- zeigt dieselbe Fassung fuer verschiedene Belege verschieden

### [`tests/kontierung.test.ts`](../tests/kontierung.test.ts)

- weist den vollen Rechnungsbetrag als offen aus, solange nichts kontiert ist
- rechnet netto aus brutto und Steuersatz
- stimmt, sobald die Zeilen den Rechnungsbetrag ergeben
- stimmt auch bei einem Split ueber mehrere Konten
- meldet eine Ueberverteilung als negativen Rest
- uebernimmt Umlagefaehigkeit und Umlageschluessel des Kontos
- uebernimmt auch ein nicht umlagefaehiges Konto richtig
- laesst einen ausdruecklich gewaehlten Umlageschluessel gewinnen
- reicht den Umlageschluessel auch beim Rest durch
- laesst die Umlagefaehigkeit je Zeile ueberschreiben
- pflegt dabei das denormalisierte Flag am Dokument mit
- bietet nur Konten des Rahmens an, der am Objekt haengt
- weist ein Konto aus einem fremden Rahmen ab
- weist einen Betrag von null ab
- legt genau den offenen Betrag an
- tut nichts, wenn nichts offen ist
- verweigert die Arbeit ohne Rechnungsbetrag am Beleg
- stellt die Aufgabe als Kontierungsstufe zu
- laesst den Beleg ohne jede Zeile nicht weiter
- laesst ihn bei unvollstaendiger Kontierung nicht weiter
- laesst ihn durch, sobald die Summe stimmt
- laesst die Klaerung trotz offener Summe zu -- sie ist keine Freigabe
- nennt den unkontierten Beleg beim Namen
- nennt bei Abweichung beide Betraege
- schweigt, wenn alles stimmt
- nimmt die Handwerkerangaben beim Entfernen der Zeile mit
- zeigt einem nicht zustaendigen Kollegen weder Zeilen noch Konten
- zeigt einem fremden Mandanten nichts
- laesst beide auch keine Zeile anlegen
- haelt den Beleg auch vor dem Loeschen einer fremden Zeile geschuetzt

### [`tests/layer.test.ts`](../tests/layer.test.ts)

- legt eine Notiz an und liefert sie zurueck
- weist eine Notiz ohne Text ab
- weist einen Layer ohne Flaeche ab
- laesst keinen Stempel von Hand anlegen
- setzt eine Schwaerzung immer auf sichtbar
- nimmt die Notiz vom Beleg, aber nicht aus der Tabelle
- blendet zweimal nicht zweimal aus
- holt einen ausgeblendeten Layer nicht zurueck
- laesst den Text einer Notiz nicht nachtraeglich aendern
- zeigt Doris die Layer eines fremden Belegs nicht
- laesst Doris keinen Layer an einem fremden Beleg anlegen
- entsteht mit dem Ereignis, auf dem ersten freien Platz
- laesst das Original unberuehrt
- setzt den zweiten Stempel auf den zweiten Platz
- setzt Seite 0, wenn kein Platz mehr ist
- blendet den Stempel aus, wenn die Freigabe verfaellt
- laesst sich nicht von Hand ausblenden
- reicht eine Schwaerzung hinaus, auch wenn sie intern gesetzt wurde
- behaelt eine interne Notiz drinnen
- reicht eine ausdruecklich freigegebene Notiz hinaus
- legt die Schwaerzung zuletzt, damit sie oben liegt
- sperrt den PDF-Download, sobald geschwaerzt wurde
- gibt den Download wieder frei, wenn die Schwaerzung ausgeblendet wird
- laesst interne Notizen drinnen
- laesst ausdruecklich freigegebene Notizen hinaus
- laesst Schwaerzungen immer hinaus
- laesst Stempel hinaus

### [`tests/lernen.test.ts`](../tests/lernen.test.ts)

- macht aus Schreibweisen denselben Wert
- findet Nummern ab vier Zeichen
- findet eine IBAN
- uebergeht zu kurze Folgen
- ordnet ueber die Kundennummer eindeutig zu
- ordnet zu, auch wenn derselbe Lieferant viele Objekte betreut
- wird bei mehreren Kandidaten rot, nicht orange
- schlaegt nichts vor, wenn kein Merkmal bekannt ist
- nimmt ein Merkmal ohne Kreditorbezug fuer jeden Lieferanten
- lernt nichts ueber die Mandantengrenze hinweg
- deaktiviert die alte Regel und schreibt eine neue
- haelt die Korrektur als Ereignis fest
- ordnet den Beleg selbst gleich mit zu
- ordnet offene Belege nach einer neuen Regel zu
- laesst mehrdeutige Belege liegen, statt zu raten

### [`tests/mahnung.test.ts`](../tests/mahnung.test.ts)

- meldet, dass der Beleg fehlt
- nennt die Stufe und die Liegezeit
- findet die Rechnung trotz abweichendem Betrag
- haelt an -- das ist der Doppelzahlungsfall
- nennt den Verantwortlichen und die Mahnkosten
- verkettet die Mahnung mit der Rechnung
- verkettet auch dann, wenn der Befund harmlos ist
- haelt eine Mahnung nicht fuer die Rechnung einer anderen Mahnung

### [`tests/mietersicht.test.ts`](../tests/mietersicht.test.ts)

- zeigt dem Mieter den Beleg aus seiner Mietzeit
- zeigt dem Nachmieter denselben Beleg nicht
- zeigt dem Nachmieter nur die Belege ab seinem Einzug
- zeigt dem Vormieter den spaeteren Beleg nicht
- verbirgt Belege ohne umlagefaehige Zeile, auch im richtigen Zeitraum
- zeigt einer Person ohne Mietverhaeltnis am Objekt nichts
- beruecksichtigt eine unterbrochene Mietzeit stueckweise
- wird beim Anlegen einer umlagefaehigen Zeile gesetzt
- faellt zurueck, wenn die letzte umlagefaehige Zeile entfaellt
- faellt zurueck, wenn die Zeile geloescht wird
- bestaetigt eine vollstaendige Kontierung
- erkennt eine zu niedrige Summe
- erkennt eine zu hohe Summe

### [`tests/nebenlauf.test.ts`](../tests/nebenlauf.test.ts)

- setzt den Lauf auf wartend
- erscheint in der Wartenliste
- verlangt eine Wiedervorlage
- verlangt eine Wiedervorlage in der Zukunft
- verlangt eine Bezeichnung
- braucht einen Lauf
- schliesst den Container und setzt den Lauf fort
- verlangt ein Ergebnis
- laesst sich nicht zweimal schliessen
- setzt den Lauf erst fort, wenn kein Container mehr offen ist
- haelt den Verlauf am Beleg fest
- meldet einen ueberfaelligen Container
- meldet einen nicht faelligen nicht
- nimmt einen geschlossenen aus der Liste
- schlaegt ein Bauteil mit laufender Frist vor
- laesst ein abgelaufenes Bauteil weg
- laesst ein Bauteil ohne Frist weg
- antwortet zum Stichtag, nicht zum heutigen Tag
- rechnet die Resttage
- sortiert die naechste Frist nach oben
- legt das alte Teil still und verkettet das neue
- schlaegt das stillgelegte Teil nicht mehr vor
- zeigt einem nicht zustaendigen Kollegen keinen Wartecontainer
- zeigt ihm auch keine Bauteile
- laesst ihn keinen Container schliessen

### [`tests/objektsperre.test.ts`](../tests/objektsperre.test.ts)

- bleibt leer, solange nicht gesperrt wurde
- meldet den Beleg als offen, bis er gesperrt ist
- nimmt den Vermerk nur einmal an
- laesst eine gesetzte Sperre nicht mehr aendern
- laesst die Loeschsperre weiterhin setzen
- tut nichts und behauptet nichts
- sperrt die archivierte Fassung und findet sie wieder
- holt nach, was vor der Einrichtung des Speichers archiviert wurde
- laesst einen Beleg offen, dessen Datei fehlt

### [`tests/ocr.test.ts`](../tests/ocr.test.ts)

- legt einen Scan in den Fehlerkorb, statt ihn still durchzulassen
- nennt das Werkzeug, wenn es eingerichtet, aber nicht aufrufbar ist
- laesst einen Beleg mit Textlayer unberuehrt
- uebernimmt den erkannten Text und meldet nichts in den Korb
- legt die erkannte Fassung als PDF/A-Derivat ab und laesst das Original
- reicht einen Fehler durch, damit die Warteschlange wiederholt
- verdoppelt die Derivate nicht
- ist ohne DMS_OCR nicht eingerichtet
- waehlt ocrmypdf, wenn es eingestellt ist
- raeumt die Zwischendateien weg, auch wenn der Aufruf scheitert
- meldet sich als nicht verfuegbar, wenn das Programm fehlt

### [`tests/platzierung.test.ts`](../tests/platzierung.test.ts)

- findet auf einer leeren Seite Platz
- legt den ersten Stempel rechts oben
- ueberdeckt keinen Text
- weicht nach unten aus, wenn oben rechts Text steht
- gibt sich ueberschneidungsfreie Plaetze
- liefert nichts, wenn die Seite voll ist
- liefert nichts, wenn die Seite kleiner ist als ein Stempel
- haelt Abstand zum Seitenrand
- haelt Abstand zum Text, nicht nur Beruehrungsfreiheit
- rechnet auch eine dicht bedruckte Seite schnell genug
- nimmt eigene Masse an
- benutzt die Vorgabemasse eines Stempels

### [`tests/plausibilitaet.test.ts`](../tests/plausibilitaet.test.ts)

- nimmt den schlechteren der beiden Werte
- ist gruen nur, wenn beide gruen sind
- wertet eine fehlende Extraktion als rot
- macht aus einem harten Befund rot, aus orange orange
- laesst die hinterlegte Bankverbindung durch
- haelt bei einer fremden Bankverbindung an
- greift nicht bei einem Kreditor ohne hinterlegte Bankverbindung
- erkennt dasselbe Papier an Kreditor, Nummer und Betrag
- haelt einen anderen Betrag nicht fuer eine Dublette
- haelt wiederkehrende Rechnungen ohne Nummer nicht fuer Dubletten
- meldet, wenn netto plus Steuer nicht den Rechnungsbetrag ergibt
- laesst einen Cent Rundung durchgehen
- prueft nicht, wenn ein Betrag fehlt
- meldet fehlende Angaben und nennt sie
- schweigt bei vollstaendigem Beleg
- meldet einen nicht zugeordneten Rechnungssteller
- setzt den Lauf auf Klaerung und legt einen Klaerungsfall an
- laesst einen unauffaelligen Beleg weiterlaufen
- loescht Befunde, die behoben sind
- faerbt die Ampel danach wieder gruen

### [`tests/postausgang.test.ts`](../tests/postausgang.test.ts)

- setzt bekannte Werte ein
- laesst einen unbekannten Platzhalter stehen
- macht aus einem bekannten, aber leeren Platzhalter einen Strich
- vertraegt Leerzeichen in den Klammern
- setzt denselben Platzhalter mehrfach ein
- kennt den Belegtext nicht -- mit Absicht
- meldet unbekannte Namen beim Pruefen einer Vorlage
- hat jeder Mandant
- bekommt auch ein neuer Mandant
- sind je Mandant getrennt
- fuellt Betreff und Text aus der Vorlage
- haelt den fertigen Text fest, nicht die Vorlage
- weist eine fehlende Vorlage ab
- weist eine abgeschaltete Vorlage ab
- weist einen Ausgang ohne Empfaenger ab
- sendet, was offen ist
- vermerkt den Erfolg
- sendet nichts zweimal
- sendet gar nicht, wenn kein Versand eingerichtet ist
- haelt einen Fehlschlag mit Grund fest
- wiederholt einen Fehlschlag nicht von selbst
- laesst sich auf Ansage wiederholen
- wiederholt einen bereits gesendeten nicht
- nimmt den Anhang mit
- scheitert sichtbar, wenn der Anhang fehlt
- liefert ohne SMTP_URL keinen Versand
- liefert ohne Absender keinen Versand
- liefert mit beidem einen Versand
- zeigt einem fremden Mandanten den Ausgang nicht
- laesst einen Fremden nicht wiederholen
- entfernt den Text nach erfolgreichem Versand
- behält den Text, solange der Versand scheitert
- lässt gewöhnliche Einträge unangetastet

### [`tests/postfach.test.ts`](../tests/postfach.test.ts)

- zeigt dem Objektverantwortlichen die neue Aufgabe
- zeigt sie einem anderen Benutzer nicht
- nimmt eine erledigte Aufgabe aus dem Postfach
- reicht den Beleg von der Objektbearbeitung an die Buchhaltung weiter
- fuehrt den Beleg ueber die ganze Kette bis zum Abschluss
- gibt die Freigabestufe niemandem ausserhalb der Geschaeftsleitung
- bietet dem Objektbearbeiter genau seine drei Entscheidungen
- bietet dem Buchhalter an derselben Stufe nur die Klaerung
- zeigt einem Benutzer ohne Sicht auf den Beleg gar nichts
- rueckt den Lauf zur naechsten Stufe
- weist einen Stempel ab, der an dieser Stufe nicht vorgesehen ist
- weist einen Stempel ab, fuer den dem Benutzer das Recht fehlt
- verlangt bei Klaerung einen Kommentar
- verlangt bei Klaerung ein Wiedervorlagedatum
- legt bei Klaerung einen Eintrag im Klaerungspostfach an
- haelt die Aufgabe bei Klaerung offen -- die Stempel bleiben gueltig
- macht den Beleg unloeschbar, sobald gestempelt wurde
- schreibt zu jedem Stempel ein Ereignis mit dem handelnden Benutzer

### [`tests/rls.test.ts`](../tests/rls.test.ts)

- zeigt einem Benutzer aus einem fremden Mandanten keinen einzigen Beleg des anderen
- zeigt einem Benutzer aus einem fremden Mandanten keine Objekte
- liefert auch bei gezieltem Zugriff auf eine bekannte ID nichts
- zeigt dem Objektbearbeiter die Belege seines Objekts
- zeigt ihm keinen Beleg eines fremden Objekts
- zeigt dem Benutzer mit mandantenweiter Rolle alle Belege seines Mandanten
- haelt die Sicht, solange die Rollenzuweisung gilt
- beendet die Sicht, wenn beide Quellen abgelaufen sind
- beendet die Sicht des Buchhalters mit dem Ablauf seiner Rolle
- gibt dem Objektbearbeiter das Recht zu stempeln
- verweigert ihm das Konfigurieren des Ablaufs
- bindet ein objektbezogenes Recht an genau dieses Objekt
- laesst eine mandantenweite Rolle fuer jedes Objekt gelten
- gibt niemandem ein Recht, das keine seiner Rollen traegt
- zeigt dem Spezialisten den Beleg seines Gebiets in einem fremden Objekt
- zeigt ihm dabei nicht die uebrigen Belege desselben Objekts
- haengt jeden Eintrag an den vorherigen an
- gibt unter der Anwendungsrolle keine Zeile zum Aendern frei
- gibt unter der Anwendungsrolle keine Zeile zum Loeschen frei
- wehrt eine Aenderung auch am Rechtesystem vorbei ab
- wehrt ein Loeschen auch am Rechtesystem vorbei ab
- verhindert das Stempeln im fremden Namen
- verlangt einen Kommentar
- verlangt ein Wiedervorlagedatum

### [`tests/schriftverkehr.test.ts`](../tests/schriftverkehr.test.ts)

- speichert und liest ein Schriftstueck
- kommt ohne Stammsatz fuer den Absender aus
- zeigt einem fremden Mandanten nichts
- bindet auch ein Schriftstueck an seinen Datenstand
- verfaellt, wenn der Beleg das Objekt wechselt
- verfaellt, wenn sich die Antwortfrist aendert
- laesst den Hash einer Rechnung unveraendert
- findet seine eigene Stufenfolge aus der Konfiguration
- hat keine Zahlungsstufe
- wird nicht zahlbar -- und das bleibt so
- wird sechs Jahre aufbewahrt, nicht zehn
- ist nach der Archivierung fest
- meldet ein Schreiben, dessen Frist naht
- meldet eine bereits abgelaufene Frist mit negativer Zahl
- laesst ein Schreiben ohne Frist weg
- laesst ein storniertes Schreiben weg
- zeigt einem fremden Mandanten keine Frist

### [`tests/stapel.test.ts`](../tests/stapel.test.ts)

- erkennt eine fast leere Seite mit dem Wort
- nennt den Grund
- erkennt eine Rechnung nicht als Trennblatt
- faellt nicht auf das Wort mitten in einer langen Rechnung herein
- vertraegt eine Seite ohne Text
- teilt an den Trennblaettern
- macht aus einem Stapel ohne Trennblatt einen Beleg
- erzeugt keinen Phantombeleg, wenn der Stapel mit einem Trennblatt beginnt
- vertraegt zwei Trennblaetter hintereinander
- endet mit einem Trennblatt ohne leeren letzten Beleg
- erkennt drei Belege in sechs Seiten
- legt **kein** Dokument an
- legt Miniaturen fuer die Korrekturansicht an
- weist dieselbe Datei ein zweites Mal ab
- weist etwas ab, das kein PDF ist
- teilt einen Beleg auf, wenn eine Trennung dazukommt
- fuehrt zwei Belege zusammen, wenn eine Trennung wegfaellt
- merkt sich, dass ein Mensch entschieden hat
- meldet eine Seite, die es nicht gibt
- legt je Beleg ein Dokument mit eigenem Hash an
- gibt jedem Beleg nur seine eigenen Seiten
- setzt den Stapel auf uebernommen
- uebernimmt nicht zweimal
- weigert sich, wenn jede Seite ein Trennblatt ist
- braucht eine Begruendung
- zeigt einem fremden Mandanten den Stapel nicht
- laesst ihn auch nicht trennen
- wird ein Beleg mit allen Seiten

### [`tests/verfahrensdoku.test.ts`](../tests/verfahrensdoku.test.ts)

- steht am archivierten Beleg
- ist die zum Zeitpunkt geltende, nicht die neueste
- bleibt leer, wenn es keine gibt -- und haelt das Archivieren nicht auf
- laesst sich nicht vom Aufrufer bestimmen
- laesst sich nicht aendern
- braucht einen Hash
- gehoert zu einem Mandanten
- kann nicht vor ihrer Vorgaengerin in Kraft treten
- darf am selben Tag ersetzt werden
- erkennt den unveraenderten Text
- erkennt einen veraenderten Text
- unterscheidet fehlend von veraendert
- haengt nur am Inhalt, nicht am Zeitpunkt
- zeigt einem fremden Mandanten keine Fassung
- haelt am Beleg die Fassung des eigenen Mandanten fest

### [`tests/vertretung.test.ts`](../tests/vertretung.test.ts)

- legt eine Vertretung fuer sich selbst an
- zeigt sie auch dem Vertreter
- weist die Vertretung an sich selbst ab
- weist ein Ende vor dem Beginn ab
- laesst niemanden ohne Recht fuer einen anderen delegieren
- erlaubt es der Geschaeftsleitung, die das Recht traegt
- lenkt die Aufgabe an den Vertreter
- vermerkt an der Aufgabe, dass eine Vertretung gewirkt hat
- greift nicht bei einer Vertretung fuer ein anderes Objekt
- greift nicht bei einer Vertretung fuer eine andere Stufenart
- greift ausserhalb des Zeitfensters nicht
- greift nach dem Widerruf nicht mehr
- laesst bereits zugewiesene Aufgaben unberuehrt
- gibt dem Vertreter nur die Stempel, die seine eigenen Rollen hergeben
- aendert die Rollen des Vertreters nicht

### [`tests/workflow.test.ts`](../tests/workflow.test.ts)

- haelt den Ablauf aus dem Seed fuer gueltig
- laesst keinen zweiten Wurzelknoten zu
- laesst kein Blatt ohne Stufe zu
- laesst keine Bedingung ausserhalb einer Verzweigung zu
- laesst zwei Geschwister nicht auf derselben Position stehen
- meldet eine Verzweigung ohne beide Zweige
- meldet einen leeren Behaelter
- meldet eine Stufe, die im Ablauf nicht eingehaengt ist
- nimmt einen gueltigen Ausdruck an
- weist ein Feld ausserhalb der Weissliste ab
- weist einen Vergleich ab, der zum Feldtyp nicht passt
- weist einen Wert vom falschen Typ ab
- verlangt fuer "in" eine nicht leere Liste
- meldet den Ort des Fehlers im verschachtelten Ausdruck
- wertet eine Betragsgrenze aus
- verknuepft mit und, oder, nicht
- prueft Mitgliedschaft in einer Liste
- vergleicht Text ohne Ruecksicht auf Gross- und Kleinschreibung
- nimmt bei fehlendem Wert den Sonst-Zweig, statt den Lauf anzuhalten
- nennt die verwendeten Felder

### [`tests/zahlung.test.ts`](../tests/zahlung.test.ts)

- haelt den Beleg auf, solange eine Pflichtstufe offen ist
- gibt ihn frei, wenn alle Pflichtstufen durch sind
- haelt ihn auf, wenn die Kontierung nicht mehr aufgeht
- haelt ihn auf bei einem harten Plausibilitaetsbefund
- haelt ihn auf ohne verifizierte Bankverbindung
- haelt ihn auf ohne Zahlungsweg am Objekt
- haelt jeden Freigabestempel am Datenstand fest
- laesst die Freigabe verfallen, wenn der Betrag sich aendert
- laesst sie auch verfallen, wenn der Beleg umgruppiert wird
- schreibt das Verfallen als Ereignis, nicht stillschweigend
- oeffnet die betroffene Aufgabe wieder
- laesst gueltige Stempel in Ruhe
- legt beim Dateiexport eine Datei an und vermerkt sie
- vermerkt die Zahlung als uebergeben, mit Zeitpunkt und Person
- uebergibt per Mail an das Ziel des Weges
- uebergibt nichts, wenn kein Postausgang eingerichtet ist
- legt bei gesperrtem Beleg keine Zahlung an
- erkennt sie am Beleg
- erkennt sie am Vertrag, wenn der Beleg nichts sagt
- laesst den Beleg gewinnen
- uebergibt nichts, vermerkt aber die Faelligkeit
- ist kein Zahlungsweg
- legt eine zweite Zahlung an, ohne den Summenzwang zu verletzen
- weist den Stempel ab, solange die Sperre greift
- haelt die Aufgabe dabei offen
- legt den Auftrag ins Ausgangsbuch, statt am Mailversand zu haengen
- sagt in der Ansicht, dass die Mail liegen bleibt
- maskiert die IBAN in der Ansicht
- uebergibt und schliesst den Lauf ab, wenn alles stimmt
- schreibt den Betrag mit Komma und ohne Tausenderpunkt
- zerlegt sich nicht an einem Semikolon im Verwendungszweck
- verdoppelt Anfuehrungszeichen im Namen
- zeigt einem nicht zustaendigen Kollegen keine Zahlung
