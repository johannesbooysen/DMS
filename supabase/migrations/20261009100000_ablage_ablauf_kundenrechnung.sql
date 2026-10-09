-- Jede Ablage hat ihren Ablauf -- und Kundenrechnungen als dritte Ablage.
--
-- Beim Bedienen gefragt: "Jede Ablage soll je nach Ablage-Art
-- (Lieferantenrechnungen, Schriftverkehr, Kundenrechnungen) einen eigenen
-- Workflow erhalten, weil die Handhabe unterschiedlich ist." Entscheidungen
-- des Hauses (09.10.2026):
--
--   * Der Ablauf haengt an **Ablage und Belegart**: Lieferantenrechnungen
--     behalten getrennte Ablaeufe fuer Rechnung, Gutschrift und Mahnung;
--     eine Belegart ohne eigenen Ablauf in der Ablage faellt auf den
--     Hausstandard der Belegart zurueck.
--   * **Ablage vor Kategorie**: Die Ablage bestimmt den Weg, eine Kategorie
--     verfeinert nur innerhalb der Ablage. Ein Beleg landet nie im Ablauf
--     einer fremden Ablage.
--   * Eine neue Ablage bekommt je Belegart einen **Entwurf als Kopie des
--     Hausstandards** -- sofort bearbeitbar; bis zur Aktivierung gilt der Standard.
--   * Beim **Ablagewechsel** wechselt der Lauf, solange keine Entscheidung
--     darin liegt (wie beim Belegartwechsel).
--   * **Kundenrechnungen** sind eine eigene Belegart (ausgehend): Kunde ist
--     eine Person aus den Stammdaten, Versand wird manuell bestaetigt,
--     Zahlungseingang ueber Stempel mit Wiedervorlage am Zahlungsziel,
--     Mahnen ist eine Klaerung mit Wiedervorlage -- keine Mail, kein
--     Bankabgleich (eigener Schritt).
--
-- Was hier entsteht:
--   1. `prozessdefinition.ablage_id` -- null = Hausstandard der Belegart.
--      Eindeutigkeit und "ein Entwurf je Geltung" schliessen die Ablage ein.
--   2. Belegart `kundenrechnung`; `rechnung_fakten.kunde_person_id`.
--   3. `prozessstufe.faellig_aus` ('frist' | 'zahlungsziel'): Die Faelligkeit
--      einer Aufgabe kann aus dem Zahlungsziel der Rechnung kommen, nicht nur
--      aus Stunden ab Anlage. Ein Trigger zieht sie nach, wenn das
--      Zahlungsziel spaeter bekannt wird.
--   4. Fuer jeden bestehenden Mandanten: Ablage "Kundenrechnungen", vier
--      Stempel und ein Hausstandard-Ablauf Kundenrechnung. Der Seed legt
--      dasselbe fuer die Testdaten an (Mandanten entstehen dort nach den
--      Migrationen).
--
-- Die Auswahl des Ablaufs steht in **einer** Funktion der Engine
-- (`ablaufWaehlen` in src/workflow/engine.ts) -- fuer Laufstart,
-- Belegartwechsel und Ablagewechsel. Drei Stellen, die denselben Ablauf
-- waehlen, waeren drei Stellen, die ihn verschieden waehlen.

-- ---------------------------------------------------------------------------
-- Teil 1: Der Ablauf kennt seine Ablage
-- ---------------------------------------------------------------------------
alter table dms.prozessdefinition add column ablage_id uuid references dms.ablage(id);
comment on column dms.prozessdefinition.ablage_id is
  'Der Ablauf gilt fuer diese Ablage (und Belegart). null = Hausstandard der Belegart, '
  'Rueckfall fuer jede Ablage ohne eigenen Ablauf. Ablage vor Kategorie.';

alter table dms.prozessdefinition
  drop constraint prozessdefinition_mandant_id_belegart_ordnungsgruppe_id_ver_key;
alter table dms.prozessdefinition
  add constraint prozessdefinition_geltung_version_key
  unique nulls not distinct (mandant_id, belegart, ordnungsgruppe_id, ablage_id, version);

drop index dms.prozessdefinition_ein_entwurf_idx;
create unique index prozessdefinition_ein_entwurf_idx
  on dms.prozessdefinition (mandant_id, belegart,
                            coalesce(ordnungsgruppe_id, '00000000-0000-0000-0000-000000000000'::uuid),
                            coalesce(ablage_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'entwurf';

-- Die Ablage gehoert zum eigenen Haus -- ein Fremdschluessel prueft das nicht.
create or replace function dms.prozessdefinition_ablage_pruefen()
returns trigger
language plpgsql
security definer
set search_path = dms, public
as $$
begin
  if new.ablage_id is not null and not exists (
    select 1 from ablage a where a.id = new.ablage_id and a.mandant_id = new.mandant_id
  ) then
    raise exception 'Die Ablage gehoert nicht zu diesem Mandanten.';
  end if;
  return new;
end;
$$;
create trigger prozessdefinition_ablage_pruefen
  before insert or update of ablage_id on dms.prozessdefinition
  for each row execute function dms.prozessdefinition_ablage_pruefen();

-- ---------------------------------------------------------------------------
-- Teil 2: Kundenrechnung als Belegart, Kunde als Person
-- ---------------------------------------------------------------------------
alter table dms.dokument drop constraint dokument_belegart_check;
alter table dms.dokument add constraint dokument_belegart_check
  check (belegart in ('rechnung', 'gutschrift', 'mahnung', 'kundenrechnung', 'schriftverkehr', 'sonstiges'));

alter table dms.rechnung_fakten add column kunde_person_id uuid references dms.person(id);
comment on column dms.rechnung_fakten.kunde_person_id is
  'Kundenrechnung: der Rechnungsempfaenger -- eine Person aus den Stammdaten '
  '(Mieter, Eigentuemer). Bei Eingangsrechnungen leer; dort steht der Kreditor.';
create index rechnung_fakten_kunde_idx on dms.rechnung_fakten (kunde_person_id)
  where kunde_person_id is not null;

-- ---------------------------------------------------------------------------
-- Teil 3: Faelligkeit aus dem Zahlungsziel
-- ---------------------------------------------------------------------------
alter table dms.prozessstufe
  add column faellig_aus text not null default 'frist'
    check (faellig_aus in ('frist', 'zahlungsziel'));
comment on column dms.prozessstufe.faellig_aus is
  'frist: faellig nach sla_stunden ab Anlage. zahlungsziel: faellig am Zahlungsziel der '
  'Rechnung (Wiedervorlage fuer den Zahlungseingang); ohne Zahlungsziel gilt die Frist.';

-- Wird das Zahlungsziel erst nach der Aufgabe bekannt (Erkennung, Nachtragen),
-- zieht die Datenbank die Faelligkeit nach -- an einer Stelle, fuer jeden Weg.
create or replace function dms.zahlungsziel_als_faelligkeit()
returns trigger
language plpgsql
security definer
set search_path = dms, public
as $$
begin
  if new.zahlungsziel is not null
     and (tg_op = 'INSERT' or old.zahlungsziel is distinct from new.zahlungsziel) then
    update aufgabe a
       set faellig_am = new.zahlungsziel::timestamptz
      from dokument_lauf l, prozessstufe s
     where l.id = a.lauf_id and l.dokument_id = new.dokument_id
       and s.id = a.stufe_id and s.faellig_aus = 'zahlungsziel'
       and a.status in ('offen', 'in_arbeit');
  end if;
  return new;
end;
$$;
create trigger rechnung_fakten_zahlungsziel_faelligkeit
  after insert or update of zahlungsziel on dms.rechnung_fakten
  for each row execute function dms.zahlungsziel_als_faelligkeit();

-- ---------------------------------------------------------------------------
-- Teil 4: Bestand -- Ablage, Stempel und Hausstandard Kundenrechnung je Mandant
-- ---------------------------------------------------------------------------
do $$
declare
  m record;
  v_ablage uuid;
  v_rolle_bh uuid;
  v_sachl uuid; v_klaer uuid; v_frei uuid; v_vers uuid; v_bez uuid; v_mahn uuid;
  v_def uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_wurzel uuid;
begin
  for m in select id from dms.mandant loop
    -- Ablage
    select id into v_ablage from dms.ablage where mandant_id = m.id and kurzcode = 'KR';
    if v_ablage is null then
      insert into dms.ablage (mandant_id, name, kurzcode, beschreibung, belegarten, ist_standard, sortierung)
      values (m.id, 'Kundenrechnungen', 'KR',
              'Rechnungen des Hauses an Mieter und Eigentuemer -- ausgehend.',
              array['kundenrechnung'], false, 15)
      returning id into v_ablage;
    end if;

    -- Stempel: vorhandene wiederverwenden (Kurzcode), fehlende anlegen.
    select id into v_sachl from dms.stempeltyp where mandant_id = m.id and kurzcode = 'SACHL';
    select id into v_klaer from dms.stempeltyp where mandant_id = m.id and entscheidung = 'klaerung' and kurzcode <> 'MAHN' order by name limit 1;
    select id into v_frei from dms.stempeltyp where mandant_id = m.id and kurzcode = 'KRFREI';
    if v_frei is null then
      insert into dms.stempeltyp (mandant_id, name, kurzcode, entscheidung, farbe)
      values (m.id, 'Versandfreigabe', 'KRFREI', 'freigabe', '#3B4A80') returning id into v_frei;
    end if;
    select id into v_vers from dms.stempeltyp where mandant_id = m.id and kurzcode = 'VERS';
    if v_vers is null then
      insert into dms.stempeltyp (mandant_id, name, kurzcode, entscheidung, farbe)
      values (m.id, 'Versendet', 'VERS', 'freigabe', '#2F6F4E') returning id into v_vers;
    end if;
    select id into v_bez from dms.stempeltyp where mandant_id = m.id and kurzcode = 'BEZ';
    if v_bez is null then
      insert into dms.stempeltyp (mandant_id, name, kurzcode, entscheidung, farbe)
      values (m.id, 'Bezahlt', 'BEZ', 'freigabe', '#2F6F4E') returning id into v_bez;
    end if;
    select id into v_mahn from dms.stempeltyp where mandant_id = m.id and kurzcode = 'MAHN';
    if v_mahn is null then
      insert into dms.stempeltyp (mandant_id, name, kurzcode, entscheidung, farbe, kommentar_pflicht)
      values (m.id, 'Gemahnt', 'MAHN', 'klaerung', '#B3271E', true) returning id into v_mahn;
    end if;

    -- Hausstandard Kundenrechnung -- nur, wenn es noch keinen gibt.
    if not exists (select 1 from dms.prozessdefinition
                    where mandant_id = m.id and belegart = 'kundenrechnung' and ablage_id is null) then
      select id into v_rolle_bh from dms.rolle where mandant_id = m.id and kurzcode = 'BH';

      insert into dms.prozessdefinition (mandant_id, belegart, version, status, aktiv_ab)
      values (m.id, 'kundenrechnung', 1, 'aktiv', now()) returning id into v_def;

      insert into dms.prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung, zustaendigkeit_typ, zustaendigkeit_ref, sla_stunden, faellig_aus)
      values (v_def, 1, 'sachlich', 'Sachlich geprueft', 'objektverantwortlich', null, 48, 'frist') returning id into v_s1;
      insert into dms.prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung, zustaendigkeit_typ, zustaendigkeit_ref, sla_stunden, faellig_aus)
      values (v_def, 2, 'freigabe', 'Versandfreigabe', case when v_rolle_bh is null then 'objektverantwortlich' else 'rolle' end, v_rolle_bh, 48, 'frist') returning id into v_s2;
      insert into dms.prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung, zustaendigkeit_typ, zustaendigkeit_ref, sla_stunden, faellig_aus)
      values (v_def, 3, 'freigabe', 'Versendet', case when v_rolle_bh is null then 'objektverantwortlich' else 'rolle' end, v_rolle_bh, 24, 'frist') returning id into v_s3;
      insert into dms.prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung, zustaendigkeit_typ, zustaendigkeit_ref, sla_stunden, faellig_aus)
      values (v_def, 4, 'freigabe', 'Zahlungseingang', case when v_rolle_bh is null then 'objektverantwortlich' else 'rolle' end, v_rolle_bh, 720, 'zahlungsziel') returning id into v_s4;

      insert into dms.prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp)
      values (v_def, null, 0, 'nacheinander') returning id into v_wurzel;
      insert into dms.prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp, stufe_id) values
        (v_def, v_wurzel, 0, 'stufe', v_s1), (v_def, v_wurzel, 1, 'stufe', v_s2),
        (v_def, v_wurzel, 2, 'stufe', v_s3), (v_def, v_wurzel, 3, 'stufe', v_s4);

      insert into dms.prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
      select v_s1, s.id, s.n from (values (v_sachl, 0), (v_klaer, 1)) as s(id, n) where s.id is not null;
      insert into dms.prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
      select v_s2, s.id, s.n from (values (v_frei, 0), (v_klaer, 1)) as s(id, n) where s.id is not null;
      insert into dms.prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung) values (v_s3, v_vers, 0);
      insert into dms.prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung) values (v_s4, v_bez, 0), (v_s4, v_mahn, 1);

      if v_rolle_bh is not null then
        insert into dms.stempel_recht (stempeltyp_id, rolle_id)
        select s.id, v_rolle_bh from (values (v_frei), (v_vers), (v_bez), (v_mahn)) as s(id)
         where not exists (select 1 from dms.stempel_recht r where r.stempeltyp_id = s.id and r.rolle_id = v_rolle_bh);
      end if;
    end if;
  end loop;
end $$;
