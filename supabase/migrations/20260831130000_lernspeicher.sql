-- Lernspeicher
--
-- Grundlage: Konzept 15. Der Unterschied zum Bestand ist hier am groessten:
-- Dort werden Zuordnungsregeln von Hand gepflegt. Hier entstehen sie aus
-- bestaetigten Zuordnungen -- Kundennummern, Zaehlernummern und
-- Vertragsnummern muss niemand eintragen, sie werden gelernt.
--
-- Zwei Regeln, die im Schema sichtbar sind:
--
--   * **Strikt mandantenbezogen.** mandant_id steht an jeder Zeile. Kein
--     Wissenstransfer ueber Mandantengrenzen, auch nicht "anonymisiert".
--   * **Nicht loeschen, deaktivieren.** Korrigiert jemand eine Zuordnung,
--     wird das alte Merkmal auf aktiv = false gesetzt und ein neues
--     geschrieben. Die Historie erklaert spaeter, warum ein Beleg damals
--     anders zugeordnet wurde.

create table zuordnungs_merkmal (
  id                 uuid primary key default gen_random_uuid(),
  mandant_id         uuid not null references mandant(id),
  kreditor_id        uuid references kreditor(id) on delete cascade,
  merkmalstyp        text not null check (merkmalstyp in
                       ('kundennummer','zaehlernummer','vertragsnummer',
                        'liegenschaftsadresse','objektnummer','iban')),
  -- Normalisiert: ohne Leerzeichen und Bindestriche, in Grossbuchstaben.
  -- Die Kundennummer "12 345-6" und "123456" sind dieselbe.
  wert_normalisiert  text not null,
  objekt_id          uuid not null references objekt(id) on delete cascade,
  trefferzahl        integer not null default 0,
  letzte_bestaetigung timestamptz,
  aktiv              boolean not null default true,
  erstellt_am        timestamptz not null default now(),

  unique (mandant_id, kreditor_id, merkmalstyp, wert_normalisiert, objekt_id)
);

create index zuordnungs_merkmal_suche_idx
  on zuordnungs_merkmal (mandant_id, merkmalstyp, wert_normalisiert)
  where aktiv;

comment on table zuordnungs_merkmal is
  'Gelernte Zuordnung: dieser Wert im Beleg bedeutet dieses Objekt. '
  'Deterministisch und damit der sichere Weg -- findet sich eine bekannte '
  'Kundennummer im Text, ist die Zuordnung eindeutig, auch wenn derselbe '
  'Lieferant fuer zwanzig Objekte taetig ist (Konzept 15).';

comment on column zuordnungs_merkmal.kreditor_id is
  'NULL heisst: gilt unabhaengig vom Rechnungssteller. Eine Zaehlernummer '
  'gehoert zum Objekt, nicht zum Lieferanten; eine Kundennummer dagegen '
  'gilt nur bei diesem einen.';


create table kontierungs_muster (
  id                 uuid primary key default gen_random_uuid(),
  mandant_id         uuid not null references mandant(id),
  kreditor_id        uuid references kreditor(id) on delete cascade,
  objekt_id          uuid references objekt(id) on delete cascade,
  positionstext_normalisiert text not null,
  konto_id           uuid not null references konto(id),
  umlageschluessel_id uuid references umlageschluessel(id),
  umlagefaehig       boolean not null default false,
  ordnungsgruppe_id  uuid references ordnungsgruppe(id),
  trefferzahl        integer not null default 0,
  letzte_bestaetigung timestamptz,
  aktiv              boolean not null default true,

  unique (mandant_id, kreditor_id, objekt_id, positionstext_normalisiert)
);

create index kontierungs_muster_suche_idx
  on kontierungs_muster (mandant_id, positionstext_normalisiert) where aktiv;

comment on table kontierungs_muster is
  'Damit die Hausmeisterrechnung beim naechsten Mal wieder in Reinigung, '
  'Gartenpflege und Winterdienst zerfaellt (Konzept 15). Vorerst ueber den '
  'normalisierten Positionstext, also exakt. Die Aehnlichkeitssuche ueber '
  'Embeddings kommt spaeter und darf laut Konzept nie besser als orange '
  'ausfallen -- ein Grund mehr, mit dem exakten Weg zu beginnen.';


create table korrektur_ereignis (
  id           uuid primary key default gen_random_uuid(),
  dokument_id  uuid not null references dokument(id) on delete cascade,
  feld         text not null,
  vorschlag    text,
  korrektur    text,
  benutzer_id  uuid not null references benutzer(id),
  zeitpunkt    timestamptz not null default now(),
  wirkung      text not null check (wirkung in ('einmalig','regel_neu','regel_ersetzt'))
);

create index on korrektur_ereignis (dokument_id);

comment on table korrektur_ereignis is
  'Was hat ein Mensch korrigiert, und was folgte daraus? Ohne diese Spur '
  'laesst sich spaeter nicht beantworten, warum eine Regel existiert -- und '
  'ob sie noch stimmt.';

-- Wie stempel_ereignis: eine Korrektur ist geschehen und bleibt geschehen.
create trigger korrektur_ereignis_unveraenderlich
  before update or delete on korrektur_ereignis
  for each row execute function app.nur_anfuegen();


alter table zuordnungs_merkmal enable row level security;
alter table kontierungs_muster enable row level security;
alter table korrektur_ereignis enable row level security;

create policy zuordnungs_merkmal_sicht on zuordnungs_merkmal for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy kontierungs_muster_sicht on kontierungs_muster for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy korrektur_ereignis_lesen on korrektur_ereignis for select
  using (exists (select 1 from dokument d where d.id = dokument_id));

create policy korrektur_ereignis_anlegen on korrektur_ereignis for insert
  with check (
    benutzer_id = app.mein_benutzer()
    and exists (select 1 from dokument d where d.id = dokument_id)
  );

grant select, insert, update, delete on zuordnungs_merkmal, kontierungs_muster to dms_app;
grant select, insert on korrektur_ereignis to dms_app;
