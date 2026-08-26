-- Kernschema: Stammdaten, Dokumentenkern, Workflow-Engine
--
-- Grundlage: docs/konzept.md, Teile B und C.
-- Berechtigungen (RLS) stehen in der Folgemigration 0002_rls.sql.
--
-- Konventionen dieses Schemas:
--   * Bezeichner deutsch und klein, wie im Konzept
--   * Wertelisten als text + check, nicht als enum-Typ. Eine neue Belegart oder
--     ein neuer Stufentyp ist damit eine Migration ohne Typumbau -- und die
--     wirklich konfigurierbaren Listen (Ordnungsgruppe, Stempeltyp,
--     Zahlungsweg) sind ohnehin Stammdatentabellen, siehe Konzept 8.8.
--   * Geldbetraege numeric(14,2), Prozentwerte numeric(5,2)

create schema if not exists app;
comment on schema app is 'Hilfsfunktionen fuer Berechtigungen und abgeleitete Werte';

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------------
-- Teil 1: Mandant, Benutzer, Gruppen
-- ---------------------------------------------------------------------------

create table mandant (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now()
);

create table benutzer (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  auth_id       uuid unique,
  name          text not null,
  email         text not null,
  aktiv         boolean not null default true,
  -- Platzhalter bis zum vollstaendigen Rollenmodell nach Konzept 17.
  -- Buchhaltung und Geschaeftsleitung brauchen Sicht auf alle Objekte des
  -- Mandanten, ohne je Objekt eine Zustaendigkeit zu tragen.
  globaler_objektzugriff boolean not null default false,
  erstellt_am   timestamptz not null default now(),
  unique (mandant_id, email)
);

comment on column benutzer.auth_id is
  'Verknuepfung zur Anmeldung (Supabase auth.users.id). Ohne FK, damit das '
  'Schema auch gegen ein blankes Postgres migriert werden kann.';

create table gruppe (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  aktiv         boolean not null default true,
  unique (mandant_id, name)
);

create table gruppe_mitglied (
  gruppe_id     uuid not null references gruppe(id) on delete cascade,
  benutzer_id   uuid not null references benutzer(id) on delete cascade,
  primary key (gruppe_id, benutzer_id)
);


-- ---------------------------------------------------------------------------
-- Teil 2: Spezialgebiete, Kontenrahmen, Ordnungsgruppen
-- ---------------------------------------------------------------------------

create table spezialgebiet (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  farbe         text,
  aktiv         boolean not null default true,
  unique (mandant_id, name)
);

comment on table spezialgebiet is
  'Im Bestand "Fachgebiet" -- Versicherung, Technik, Legal. Lenkt die '
  'Zustaendigkeit unabhaengig von der Objektzustaendigkeit.';

create table kontenrahmen (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  aktiv         boolean not null default true,
  unique (mandant_id, name)
);

create table umlageschluessel (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  kurzcode      text not null,
  aktiv         boolean not null default true,
  unique (mandant_id, kurzcode)
);

create table ordnungsgruppe (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  name                  text not null,
  kurzcode              text not null,
  sortierung            integer not null default 0,
  farbe                 text,
  aktiv                 boolean not null default true,
  spezialgebiet_id      uuid references spezialgebiet(id),
  -- prozessdefinition_id und konto_vorschlag_id folgen als alter table,
  -- weil die Zieltabellen zyklisch verweisen.
  ki_beschreibung       text,
  unique (mandant_id, kurzcode)
);

comment on table ordnungsgruppe is
  'Steuergroesse des Workflows, nicht nur Ablagemerkmal: spezialgebiet_id '
  'lenkt die Zustaendigkeit, prozessdefinition_id erlaubt je Gruppe eine '
  'eigene Stufenfolge (Konzept 4).';

comment on column ordnungsgruppe.ki_beschreibung is
  'Freitext je Gruppe, wird in den Extraktions-Prompt eingebettet. Damit '
  'funktioniert der KI-Vorschlag fuer eine neu angelegte Gruppe ab dem '
  'naechsten Beleg, ohne Eingriff in den Code.';

comment on column ordnungsgruppe.aktiv is
  'Kein Loeschen, nur Deaktivieren -- sobald Belege zugeordnet sind, waere '
  'eine Loeschung ein Bruch in der Historie (Konzept 4).';

create table konto (
  id                        uuid primary key default gen_random_uuid(),
  kontenrahmen_id           uuid not null references kontenrahmen(id),
  kontonummer               text not null,
  bezeichnung               text not null,
  umlagefaehig_default      boolean not null default false,
  umlageschluessel_default_id uuid references umlageschluessel(id),
  ordnungsgruppe_default_id uuid references ordnungsgruppe(id),
  ist_ruecklage             boolean not null default false,
  aktiv                     boolean not null default true,
  unique (kontenrahmen_id, kontonummer)
);

alter table ordnungsgruppe
  add column konto_vorschlag_id uuid references konto(id);

create table belegmerkmal (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  aktiv         boolean not null default true,
  unique (mandant_id, name)
);


-- ---------------------------------------------------------------------------
-- Teil 3: Zahlungsweg und Objekt
-- ---------------------------------------------------------------------------

create table zahlungsweg (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  name              text not null,
  aktiv             boolean not null default true,
  art               text not null check (art in ('mail','datei_export','extern','lastschrift')),
  ziel              text,
  bankdaten_pflicht boolean not null default true,
  archiviert_sofort boolean not null default false,
  unique (mandant_id, name)
);

comment on table zahlungsweg is
  'scan2bank und SFirm sind Zeilen dieser Tabelle, kein Sonderfall im Code '
  '(Konzept 12). Ein dritter Weg wird in den Einstellungen angelegt.';

create table objekt (
  id                          uuid primary key default gen_random_uuid(),
  mandant_id                  uuid not null references mandant(id),
  objektnummer                text not null,
  bezeichnung                 text not null,
  adresse                     text,
  verwaltungsart              text not null check (verwaltungsart in ('weg','miet','se')),
  wirtschaftsjahr_beginn      smallint not null default 1
                              check (wirtschaftsjahr_beginn between 1 and 12),
  kontenrahmen_id             uuid references kontenrahmen(id),
  standard_ordnungsgruppe_id  uuid references ordnungsgruppe(id),
  spezialgebiet_id            uuid references spezialgebiet(id),
  eskalationsgrenze_brutto    numeric(14,2),
  zahlungsweg_id              uuid references zahlungsweg(id),
  externe_id                  text,
  sync_quelle                 text,
  sync_stand                  timestamptz,
  aktiv                       boolean not null default true,
  unique (mandant_id, objektnummer)
);

comment on table objekt is
  'Liefert das, was der Posteingangsstempel per Klick-Fuellen setzt: '
  'Ordnungsgruppe, Spezialgebiet, Zahlungsweg, Eskalationsgrenze.';

comment on column objekt.externe_id is
  'Adapterschicht: externe_id, sync_quelle und sync_stand sind der Grund, '
  'warum dieselbe Codebasis eigenstaendig und als Modul laufen kann '
  '(Konzept 20).';

create table objekt_zustaendigkeit (
  id            uuid primary key default gen_random_uuid(),
  objekt_id     uuid not null references objekt(id) on delete cascade,
  benutzer_id   uuid not null references benutzer(id),
  art           text not null check (art in ('hauptverantwortlich','vertretung')),
  gueltig_von   date not null default current_date,
  gueltig_bis   date
);

create index on objekt_zustaendigkeit (benutzer_id, gueltig_von, gueltig_bis);
create index on objekt_zustaendigkeit (objekt_id);

create table spezialgebiet_zustaendigkeit (
  id                uuid primary key default gen_random_uuid(),
  spezialgebiet_id  uuid not null references spezialgebiet(id) on delete cascade,
  benutzer_id       uuid references benutzer(id),
  gruppe_id         uuid references gruppe(id),
  -- NULL = mandantenweit zustaendig
  objekt_id         uuid references objekt(id),
  check (num_nonnulls(benutzer_id, gruppe_id) = 1)
);

create index on spezialgebiet_zustaendigkeit (benutzer_id);
create index on spezialgebiet_zustaendigkeit (gruppe_id);


-- ---------------------------------------------------------------------------
-- Teil 4: Kreditor und Vertrag
-- ---------------------------------------------------------------------------

create table kreditor (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  ust_id        text,
  steuernummer  text,
  externe_id    text,
  status        text not null default 'aktiv'
                check (status in ('aktiv','gesperrt','inaktiv'))
);

create index on kreditor (mandant_id, name);

create table kreditor_bankverbindung (
  id                uuid primary key default gen_random_uuid(),
  kreditor_id       uuid not null references kreditor(id) on delete cascade,
  iban              text not null,
  status            text not null default 'neu'
                    check (status in ('verifiziert','neu','gesperrt')),
  erstmals_gesehen  timestamptz not null default now(),
  bestaetigt_von    uuid references benutzer(id),
  bestaetigt_am     timestamptz,
  unique (kreditor_id, iban)
);

comment on table kreditor_bankverbindung is
  'Grundlage der harten Rot-Pruefung "IBAN gehoert zum bekannten Kreditor" '
  '(Konzept 14). Betrugsschutz, deshalb hart und nicht nur eine Warnung.';

create table vertrag (
  id                  uuid primary key default gen_random_uuid(),
  kreditor_id         uuid not null references kreditor(id),
  objekt_id           uuid not null references objekt(id),
  bezeichnung         text not null,
  turnus              text check (turnus in ('monatlich','quartalsweise','halbjaehrlich','jaehrlich','unregelmaessig')),
  erwarteter_betrag   numeric(14,2),
  toleranz_prozent    numeric(5,2),
  zahlungsart         text not null default 'ueberweisung'
                      check (zahlungsart in ('ueberweisung','lastschrift')),
  naechste_erwartung  date,
  aktiv               boolean not null default true
);

create index on vertrag (objekt_id);
create index on vertrag (kreditor_id);


-- ---------------------------------------------------------------------------
-- Teil 5: Workflow-Definition
-- ---------------------------------------------------------------------------

create table prozessdefinition (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  belegart          text not null,
  ordnungsgruppe_id uuid references ordnungsgruppe(id),
  version           integer not null default 1,
  status            text not null default 'entwurf'
                    check (status in ('entwurf','aktiv','abgeloest')),
  aktiv_ab          timestamptz,
  aktiv_bis         timestamptz,
  erstellt_von      uuid references benutzer(id),
  erstellt_am       timestamptz not null default now(),
  unique (mandant_id, belegart, ordnungsgruppe_id, version)
);

comment on table prozessdefinition is
  'Wird nie ueberschrieben, sondern neu versioniert. Laufende Belege behalten '
  'ihre Version bis zum Abschluss (Konzept 8.8) -- sonst haengen halb '
  'geprueffte Rechnungen in einer Stufe, die es beim Start nicht gab.';

alter table ordnungsgruppe
  add column prozessdefinition_id uuid references prozessdefinition(id);

create table prozessstufe (
  id                        uuid primary key default gen_random_uuid(),
  definition_id             uuid not null references prozessdefinition(id) on delete cascade,
  reihenfolge               integer not null,
  parallelgruppe            integer,
  stufentyp                 text not null check (stufentyp in
                              ('zuordnung','sachlich','freigabe','rechnerisch',
                               'kontierung','zahlung','extern_pruefung','systemaktion')),
  bezeichnung               text not null,
  pflicht                   boolean not null default true,
  betrag_von                numeric(14,2),
  betrag_bis                numeric(14,2),
  zustaendigkeit_typ        text not null check (zustaendigkeit_typ in
                              ('objektverantwortlich','rolle','gruppe',
                               'spezialgebiet','extern','system')),
  zustaendigkeit_ref        uuid,
  sla_stunden               integer,
  eskalation_nach_stunden   integer,
  eskalation_an             uuid references benutzer(id),
  vier_augen_pflicht        boolean not null default false,
  unique (definition_id, reihenfolge)
);

comment on column prozessstufe.parallelgruppe is
  'Gleiche Nummer = Stufen laufen gleichzeitig, Reihenfolge egal, alle '
  'muessen abschliessen. So laesst sich der Bestandsablauf nachbilden, in dem '
  'sachliche Pruefung, rechnerische Pruefung und Kontierung ein Schritt sind.';

create table prozess_override (
  id                  uuid primary key default gen_random_uuid(),
  objekt_id           uuid not null references objekt(id) on delete cascade,
  stufe_id            uuid not null references prozessstufe(id) on delete cascade,
  aktiv               boolean not null default true,
  betrag_von          numeric(14,2),
  zustaendigkeit_ref  uuid,
  unique (objekt_id, stufe_id)
);

comment on table prozess_override is
  'Objektabweichung als kurze Ausnahmeliste, nicht als eigener Prozess -- '
  'z. B. "WEG A: Beiratsfreigabe ab 1.000 EUR".';

create table stempeltyp (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  name              text not null,
  kurzcode          text not null,
  entscheidung      text not null check (entscheidung in
                      ('freigabe','ablehnung','rueckgabe','klaerung','systemaktion')),
  farbe             text,
  sichtbar_auf_beleg boolean not null default true,
  kommentar_pflicht boolean not null default false,
  vier_augen_pflicht boolean not null default false,
  aktiv             boolean not null default true,
  unique (mandant_id, kurzcode)
);

comment on table stempeltyp is
  'Der Stempel traegt die Entscheidung, nicht das Ziel. Wohin der Beleg '
  'danach geht, leitet die Engine aus der Prozessdefinition ab (Konzept 8.7). '
  'Deshalb gibt es hier bewusst kein Zielfeld.';

create table stempel_recht (
  id            uuid primary key default gen_random_uuid(),
  stempeltyp_id uuid not null references stempeltyp(id) on delete cascade,
  gruppe_id     uuid references gruppe(id),
  rolle         text,
  check (num_nonnulls(gruppe_id, rolle) = 1)
);


-- ---------------------------------------------------------------------------
-- Teil 6: Vorgang und Dokumentenkern
-- ---------------------------------------------------------------------------

create table vorgang (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  objekt_id         uuid not null references objekt(id),
  art               text not null check (art in
                      ('schadensfall','massnahme','rechtsstreit',
                       'mieterwechsel','beschlussumsetzung')),
  spezialgebiet_id  uuid references spezialgebiet(id),
  bezeichnung       text not null,
  status            text not null default 'offen'
                    check (status in ('offen','wartend','abgeschlossen')),
  eroeffnet_am      timestamptz not null default now(),
  abgeschlossen_am  timestamptz
);

create index on vorgang (objekt_id, status);

create table dokument (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  objekt_id             uuid references objekt(id),
  vorgang_id            uuid references vorgang(id),
  belegart              text not null check (belegart in
                          ('rechnung','gutschrift','mahnung','schriftverkehr','sonstiges')),
  ordnungsgruppe_id     uuid references ordnungsgruppe(id),
  -- Denormalisiert aus Objekt bzw. Ordnungsgruppe, gesetzt beim
  -- Posteingangsstempel. Traegt die Sichtbarkeit fuer den Spezialisten,
  -- ohne dass er Zugriff auf die uebrigen Belege des Objekts erhaelt
  -- (Konzept 17) -- und erspart der RLS-Policy einen Join.
  spezialgebiet_id      uuid references spezialgebiet(id),
  eingangskanal         text not null check (eingangskanal in
                          ('mail','scan','upload','ftp')),
  eingang_am            timestamptz not null default now(),
  erfasst_von           uuid references benutzer(id),
  seitenzahl            integer,
  inhalt_hash           text not null,
  ampel_extraktion      text check (ampel_extraktion in ('gruen','orange','rot')),
  ampel_plausibilitaet  text check (ampel_plausibilitaet in ('gruen','orange','rot')),
  ampel_gesamt          text check (ampel_gesamt in ('gruen','orange','rot')),
  dublette_von          uuid references dokument(id),
  storage_praefix       text not null,
  status                text not null default 'in_aufbereitung'
                        check (status in ('in_aufbereitung','laufend','klaerung',
                                          'abgelehnt','archiviert','storniert'))
);

comment on column dokument.ampel_gesamt is
  'Der schlechtere Wert aus Extraktion und Plausibilitaet. Gruen nur, wenn '
  'beide gruen sind und keine harte Pruefung anschlaegt (Konzept 14).';

comment on column dokument.dublette_von is
  'Dublette ist ein harter Rot-Fall: Verkettung ja, Workflow-Start nein.';

-- Der Index fuer den objektuebergreifenden Feed. Konzept 21:
-- Ein Index auf eingang_am ALLEIN verschlechterte den Feed von 13 auf 30 ms,
-- weil der Planer ihn waehlte und die Objektselektivitaet verlor.
-- Der zusammengesetzte Index genuegt -- keinen zweiten daneben anlegen.
create index dokument_objekt_eingang_idx on dokument (objekt_id, eingang_am desc);

create index dokument_mandant_status_idx on dokument (mandant_id, status);
create index dokument_inhalt_hash_idx on dokument (mandant_id, inhalt_hash);
create index dokument_spezialgebiet_idx on dokument (spezialgebiet_id)
  where spezialgebiet_id is not null;

create table dokument_datei (
  id            uuid primary key default gen_random_uuid(),
  dokument_id   uuid not null references dokument(id) on delete cascade,
  variante      text not null check (variante in
                  ('original','email_eml','zugferd_xml','pdfa_derivat',
                   'ansicht_webp','export_derivat')),
  storage_key   text not null,
  mime          text not null,
  groesse       bigint,
  hash          text,
  seite         integer,
  erstellt_am   timestamptz not null default now()
);

create index on dokument_datei (dokument_id, variante);

comment on table dokument_datei is
  'Archiviert wird, was eingegangen ist. Bei Mailanhang beides -- email_eml '
  'UND original. Bei ZUGFeRD ist das XML der fuehrende Datensatz, das PDF die '
  'Ansicht. PDF/A entsteht als zusaetzliches Derivat und ersetzt das Original '
  'nie (Konzept 5).';

create table dokument_seite (
  dokument_id   uuid not null references dokument(id) on delete cascade,
  seite         integer not null,
  text          text,
  text_tsv      tsvector generated always as
                  (to_tsvector('german', coalesce(text, ''))) stored,
  breite        integer,
  hoehe         integer,
  primary key (dokument_id, seite)
);

create index dokument_seite_tsv_idx on dokument_seite using gin (text_tsv);

comment on table dokument_seite is
  'Volltext pro Seite, damit die Trefferhervorhebung ohne Nachladen des PDF '
  'auskommt. Auch Grundlage der Stempelplatzierung: aus den belegten '
  'Textbereichen sucht der Renderer den groessten freien Block.';

create table dokument_merkmal (
  dokument_id     uuid not null references dokument(id) on delete cascade,
  belegmerkmal_id uuid not null references belegmerkmal(id),
  quelle          text not null check (quelle in ('ki','regel','mensch')),
  primary key (dokument_id, belegmerkmal_id)
);

create table extraktion_feld (
  id            uuid primary key default gen_random_uuid(),
  dokument_id   uuid not null references dokument(id) on delete cascade,
  feldname      text not null,
  wert_text     text,
  wert_zahl     numeric(14,2),
  wert_datum    date,
  confidence    numeric(4,3) check (confidence between 0 and 1),
  seite         integer,
  bbox          numeric[],
  quelle        text not null check (quelle in ('ki','zugferd','regel','mensch')),
  modell        text,
  bestaetigt_von uuid references benutzer(id),
  bestaetigt_am timestamptz
);

create index on extraktion_feld (dokument_id, feldname);

comment on column extraktion_feld.bbox is
  'Fundstelle als [x, y, breite, hoehe]. Jedes Feld traegt seine Belegstelle, '
  'damit ein Klick im Formular an die Stelle im Beleg springt.';

comment on column extraktion_feld.modell is
  'Welches Modell in welcher Fassung den Wert geliefert hat -- ohne das ist '
  'ein Extraktionsergebnis nicht nachvollziehbar.';

create table rechnung_fakten (
  dokument_id     uuid primary key references dokument(id) on delete cascade,
  kreditor_id     uuid references kreditor(id),
  vertrag_id      uuid references vertrag(id),
  rechnungsnummer text,
  rechnungsdatum  date,
  leistung_von    date,
  leistung_bis    date,
  netto           numeric(14,2),
  steuer          numeric(14,2),
  brutto          numeric(14,2),
  zahlungsziel    date,
  skonto_prozent  numeric(5,2),
  skonto_bis      date,
  iban_im_beleg   text,
  zahlungsart     text check (zahlungsart in ('ueberweisung','lastschrift')),
  wirtschaftsjahr integer
);

create index on rechnung_fakten (kreditor_id, rechnungsnummer);
create index on rechnung_fakten (skonto_bis) where skonto_bis is not null;

comment on column rechnung_fakten.rechnungsdatum is
  'Fuehrend fuer die Periodenzuordnung. Leistungszeitraum und Zahlungsdatum '
  'werden trotzdem gefuehrt -- die Betriebskostenabrechnung braucht das '
  'Leistungsprinzip, die WEG-Jahresabrechnung das Abflussprinzip, und '
  'nacherfassen laesst sich beides nicht (Konzept 5).';

create table dokument_beziehung (
  von_dokument  uuid not null references dokument(id) on delete cascade,
  zu_dokument   uuid not null references dokument(id) on delete cascade,
  art           text not null check (art in
                  ('angebot_zu','auftrag_zu','rechnung_zu','mahnung_zu',
                   'gutschrift_zu','antwort_auf','dublette_von','ersetzt')),
  primary key (von_dokument, zu_dokument, art),
  check (von_dokument <> zu_dokument)
);

create index on dokument_beziehung (zu_dokument);


-- ---------------------------------------------------------------------------
-- Teil 7: Lauf, Aufgabe, Stempelereignis, Klaerung
-- ---------------------------------------------------------------------------

create table dokument_lauf (
  id                  uuid primary key default gen_random_uuid(),
  dokument_id         uuid not null references dokument(id) on delete cascade,
  definition_id       uuid not null references prozessdefinition(id),
  definition_version  integer not null,
  aktuelle_stufe_id   uuid references prozessstufe(id),
  freigabe_hash       text,
  kontierungs_hash    text,
  status              text not null default 'laufend'
                      check (status in ('laufend','klaerung','abgeschlossen','storniert')),
  gestartet_am        timestamptz not null default now(),
  beendet_am          timestamptz,
  unique (dokument_id)
);

comment on column dokument_lauf.aktuelle_stufe_id is
  'Cache. Der Status ergibt sich aus den Stempelereignissen -- diese Spalte '
  'spart nur den Aufbau der Kette bei jeder Listenabfrage.';

comment on column dokument_lauf.definition_version is
  'Friert die Fassung ein. Eine neue Prozessversion aendert laufende Belege '
  'nicht.';

create table aufgabe (
  id                  uuid primary key default gen_random_uuid(),
  lauf_id             uuid not null references dokument_lauf(id) on delete cascade,
  stufe_id            uuid not null references prozessstufe(id),
  zugewiesen_benutzer uuid references benutzer(id),
  zugewiesen_gruppe   uuid references gruppe(id),
  uebernommen_von     uuid references benutzer(id),
  uebernommen_am      timestamptz,
  sperre_bis          timestamptz,
  faellig_am          timestamptz,
  eskalationsstufe    integer not null default 0,
  status              text not null default 'offen'
                      check (status in ('offen','in_arbeit','erledigt','entfallen')),
  erstellt_am         timestamptz not null default now(),
  erledigt_am         timestamptz
);

-- Postfachabfrage: offene Aufgaben eines Benutzers. Konzept 21 misst dafuer
-- 2,2 ms bei 1 Mio. Dokumenten und 10.254 offenen Aufgaben.
create index aufgabe_postfach_idx on aufgabe (zugewiesen_benutzer, status, faellig_am)
  where status in ('offen','in_arbeit');

create index aufgabe_pool_idx on aufgabe (zugewiesen_gruppe, status)
  where status in ('offen','in_arbeit');

create index on aufgabe (lauf_id);

comment on column aufgabe.sperre_bis is
  'Pool-Aufgaben werden beim Uebernehmen gesperrt und fallen bei Untaetigkeit '
  'automatisch in den Pool zurueck (Konzept 8.6).';

create table stempel_ereignis (
  id              uuid primary key default gen_random_uuid(),
  folge           bigint generated always as identity,
  lauf_id         uuid not null references dokument_lauf(id) on delete cascade,
  stufe_id        uuid references prozessstufe(id),
  benutzer_id     uuid not null references benutzer(id),
  stempeltyp_id   uuid references stempeltyp(id),
  entscheidung    text not null check (entscheidung in
                    ('freigabe','ablehnung','rueckgabe','klaerung',
                     'uebersprungen','verfallen')),
  kommentar       text,
  freigabe_hash   text,
  zeitpunkt       timestamptz not null default now(),
  vorheriger_hash text,
  eintrag_hash    text not null
);

create index stempel_ereignis_lauf_idx on stempel_ereignis (lauf_id, folge);

comment on table stempel_ereignis is
  'APPEND ONLY. Der Status ergibt sich aus diesen Ereignissen; '
  'dokument_lauf haelt nur den Cache. vorheriger_hash und eintrag_hash bilden '
  'eine Hash-Kette ueber alle Ereignisse eines Dokuments -- nachtraegliche '
  'Manipulation ist erkennbar. Erfuellt zugleich die GoBD-Protokollpflicht.';

create table klaerung (
  id                      uuid primary key default gen_random_uuid(),
  dokument_id             uuid not null references dokument(id) on delete cascade,
  grund                   text not null,
  kategorie               text,
  kommentar               text not null,
  eroeffnet_von           uuid not null references benutzer(id),
  eroeffnet_am            timestamptz not null default now(),
  verantwortlich_benutzer uuid not null references benutzer(id),
  stufe_beim_eintritt     uuid references prozessstufe(id),
  wiedervorlage_am        date not null,
  erledigt_am             timestamptz,
  ergebnis                text,
  check (length(btrim(kommentar)) > 0)
);

create index klaerung_postfach_idx on klaerung (verantwortlich_benutzer, wiedervorlage_am)
  where erledigt_am is null;

comment on table klaerung is
  'Kommentar und Wiedervorlagedatum sind Pflicht -- ohne beides kein Eintritt '
  '(Konzept 8.5). Der Lauf geht auf klaerung, die Stufe wird gemerkt, '
  'bestehende Stempel bleiben gueltig.';

create table zuweisung_ereignis (
  id            uuid primary key default gen_random_uuid(),
  dokument_id   uuid not null references dokument(id) on delete cascade,
  von_benutzer  uuid not null references benutzer(id),
  an_benutzer   uuid not null references benutzer(id),
  grund         text,
  zeitpunkt     timestamptz not null default now()
);

comment on table zuweisung_ereignis is
  'Ausnahmefall: jemand gibt einen Beleg gezielt einer Person. Protokolliert, '
  'aber ohne die Stufe zu veraendern -- das haelt die Ausnahme aus der '
  'Prozessdefinition heraus.';


-- ---------------------------------------------------------------------------
-- Teil 8: Hash-Kette und Append-only-Schutz
-- ---------------------------------------------------------------------------

create or replace function app.stempel_kette()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
declare
  vorher text;
begin
  select e.eintrag_hash into vorher
    from stempel_ereignis e
   where e.lauf_id = new.lauf_id
   order by e.folge desc
   limit 1;

  new.vorheriger_hash := vorher;
  new.eintrag_hash := encode(digest(
      coalesce(vorher, '')
      || new.lauf_id::text
      || coalesce(new.stufe_id::text, '')
      || new.benutzer_id::text
      || new.entscheidung
      || coalesce(new.freigabe_hash, '')
      || new.zeitpunkt::text,
    'sha256'), 'hex');

  return new;
end;
$$;

create trigger stempel_ereignis_kette
  before insert on stempel_ereignis
  for each row execute function app.stempel_kette();

create or replace function app.nur_anfuegen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Tabelle % ist append-only (%). Aenderung ist ein neues Ereignis.',
    tg_table_name, tg_op;
end;
$$;

create trigger stempel_ereignis_unveraenderlich
  before update or delete on stempel_ereignis
  for each row execute function app.nur_anfuegen();

create trigger zuweisung_ereignis_unveraenderlich
  before update or delete on zuweisung_ereignis
  for each row execute function app.nur_anfuegen();


-- ---------------------------------------------------------------------------
-- Teil 9: Freigabe-Hash
-- ---------------------------------------------------------------------------

create or replace function app.freigabe_hash(p_dokument_id uuid)
returns text
language sql
stable
set search_path = public, app, extensions
as $$
  select encode(digest(
      coalesce(f.kreditor_id::text, '')
      || coalesce(f.rechnungsnummer, '')
      || coalesce(f.rechnungsdatum::text, '')
      || coalesce(f.brutto::text, '')
      || coalesce(d.objekt_id::text, ''),
    'sha256'), 'hex')
    from dokument d
    join rechnung_fakten f on f.dokument_id = d.id
   where d.id = p_dokument_id;
$$;

comment on function app.freigabe_hash(uuid) is
  'Bindet die Stempel an den Datenstand. Aendert sich ein freigaberelevantes '
  'Feld, verfallen die Stempel (Konzept 8.4). Bewusst OHNE die Kontierung: '
  'die liegt nach den Freigaben und wuerde sie sonst jedes Mal entwerten -- '
  'dafuer gibt es den getrennten kontierungs_hash.';
