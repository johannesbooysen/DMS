-- Zahlungsuebergabe und die harte Sperre davor
--
-- Konzept 12. Der Zahlungsweg ist Stammdatum am Objekt, keine Entscheidung im
-- Beleg: geprueft, freigegeben, uebergeben, archiviert -- ueberall gleich, nur
-- das Ziel unterscheidet sich.
--
-- Der wichtigere Teil dieser Migration ist aber nicht die Tabelle `zahlung`,
-- sondern was **vor** ihr steht. Konzept 8.2: "Vor der Bankuebergabe prueft die
-- Engine, dass jede Pflichtstufe einen gueltigen Stempel hat -- das ist die
-- harte Sperre vor der Zahlung."
--
-- Das Wort, an dem alles haengt, ist **gueltig**. Ein gesetzter Stempel ist
-- nicht dasselbe wie ein gueltiger: Wird nach der Freigabe der Betrag
-- korrigiert oder der Beleg umgruppiert, gilt die Freigabe einer anderen
-- Rechnung. Genau dafuer gibt es `stempel_ereignis.freigabe_hash` -- die Spalte
-- steht seit dem Kernschema und wurde bisher nie gefuellt. Diese Migration
-- fuellt sie und wertet sie aus.


-- ---------------------------------------------------------------------------
-- Teil 1: Der Freigabe-Hash am Stempel
-- ---------------------------------------------------------------------------

-- Jeder Freigabestempel haelt fest, unter welchem Datenstand er gegeben
-- wurde. Nicht die Anwendung setzt ihn, sondern die Datenbank: Ein Stempel
-- ohne Hash waere ein Stempel, der nie verfallen kann, und die Luecke faellt
-- niemandem auf.
create or replace function app.stempel_hash_setzen()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if new.entscheidung = 'freigabe' and new.freigabe_hash is null then
    select app.freigabe_hash(l.dokument_id) into new.freigabe_hash
      from dokument_lauf l where l.id = new.lauf_id;
  end if;
  return new;
end;
$$;

-- Vor der Kette: Der Hash geht in den Ketteneintrag ein.
create trigger stempel_ereignis_freigabe_hash
  before insert on stempel_ereignis
  for each row execute function app.stempel_hash_setzen();

comment on function app.stempel_hash_setzen() is
  'Bindet jeden Freigabestempel an den Datenstand, unter dem er gegeben wurde '
  '(Konzept 8.4). In der Datenbank und nicht in der Anwendung, weil ein '
  'vergessener Hash einen Stempel ergaebe, der nie verfaellt.';


-- Welche Stufen haben einen gueltigen Freigabestempel?
--
-- Gueltig heisst: Es gibt eine Freigabe, sie ist nicht spaeter verfallen, und
-- der Hash von damals ist der von heute.
create or replace function app.gueltige_freigaben(p_lauf_id uuid)
returns table (stufe_id uuid, gueltig boolean)
language sql
stable
set search_path = public, app
as $$
  with jetzt as (
    select app.freigabe_hash(l.dokument_id) as hash
      from dokument_lauf l where l.id = p_lauf_id
  ),
  letzte as (
    select distinct on (e.stufe_id)
           e.stufe_id, e.entscheidung, e.freigabe_hash
      from stempel_ereignis e
     where e.lauf_id = p_lauf_id
       and e.stufe_id is not null
       and e.entscheidung in ('freigabe','verfallen')
     order by e.stufe_id, e.folge desc
  )
  select l.stufe_id,
         l.entscheidung = 'freigabe'
           and l.freigabe_hash is not distinct from (select hash from jetzt)
    from letzte l;
$$;


-- Laesst verfallene Freigaben verfallen -- sichtbar, nicht stillschweigend.
--
-- Je betroffener Stufe ein Ereignis `verfallen`, die Aufgabe wird wieder
-- geoeffnet, und der Lauf springt auf die frueheste betroffene Stufe zurueck.
-- Ohne das Ereignis stuende spaeter im Protokoll eine Freigabe, die nicht mehr
-- gilt, und niemand koennte erklaeren, warum der Beleg zurueckgelaufen ist.
create or replace function app.freigaben_nachpruefen(p_lauf_id uuid)
returns integer
language plpgsql
set search_path = public, app
as $$
declare
  betroffen uuid[];
  s         uuid;
  anzahl    integer;
begin
  select coalesce(array_agg(g.stufe_id), '{}')
    into betroffen
    from app.gueltige_freigaben(p_lauf_id) g
   where not g.gueltig;

  anzahl := coalesce(array_length(betroffen, 1), 0);
  if anzahl = 0 then
    return 0;
  end if;

  foreach s in array betroffen loop
    insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung, kommentar)
    select p_lauf_id, s, e.benutzer_id, 'verfallen',
           'Freigaberelevante Daten haben sich nach der Freigabe geaendert.'
      from stempel_ereignis e
     where e.lauf_id = p_lauf_id and e.stufe_id = s and e.entscheidung = 'freigabe'
     order by e.folge desc
     limit 1;

    update aufgabe
       set status = 'offen', erledigt_am = null
     where lauf_id = p_lauf_id and stufe_id = s and status = 'erledigt';
  end loop;

  -- Zurueck auf die frueheste betroffene Stufe.
  update dokument_lauf l
     set aktuelle_stufe_id = (
           select st.id from prozessstufe st
            where st.id = any (betroffen)
            order by st.reihenfolge
            limit 1),
         status = 'laufend',
         beendet_am = null
   where l.id = p_lauf_id;

  return anzahl;
end;
$$;

comment on function app.freigaben_nachpruefen(uuid) is
  'Schreibt je verfallenem Stempel ein Ereignis `verfallen` und springt auf '
  'die erste betroffene Stufe zurueck (Konzept 8.4). Wird vor der Zahlung '
  'aufgerufen und gehoert kuenftig auch hinter jede Aenderung an '
  'rechnung_fakten oder an der Objektzuordnung.';


-- ---------------------------------------------------------------------------
-- Teil 2: Zahlung
-- ---------------------------------------------------------------------------

create table zahlung (
  id                uuid primary key default gen_random_uuid(),
  dokument_id       uuid not null references dokument(id) on delete cascade,
  betrag            numeric(14,2) not null check (betrag > 0),
  art               text not null check (art in ('voll','eigenanteil','teilbetrag')),
  zahlungsweg_id    uuid references zahlungsweg(id),
  bankverbindung_id uuid references kreditor_bankverbindung(id),
  faellig_am        date,

  -- Nicht im Spaltenkatalog des Konzepts, aber noetig: `uebergeben_am is null`
  -- allein kann eine Lastschrift nicht von einer wartenden Ueberweisung
  -- unterscheiden. Bei der Lastschrift zieht der Kreditor selbst ein -- es
  -- gibt nichts zu uebergeben, und die Zeile darf trotzdem nicht ewig als
  -- offen in einer Liste stehen.
  status            text not null default 'offen'
                    check (status in ('offen','uebergeben','lastschrift')),

  uebergeben_am     timestamptz,
  uebergeben_von    uuid references benutzer(id),
  protokoll         text,
  rueckmeldung      text,
  erstellt_am       timestamptz not null default now(),

  check ((status = 'uebergeben') = (uebergeben_am is not null)),
  -- Lastschrift ist kein Weg, sondern eine Eigenschaft des Kreditors oder
  -- Vertrags (Konzept 12) -- also auch kein zahlungsweg_id.
  check (status <> 'lastschrift' or zahlungsweg_id is null)
);

create index zahlung_dokument_idx on zahlung (dokument_id);
create index zahlung_offen_idx on zahlung (faellig_am) where status = 'offen';

-- Eine Vollzahlung je Beleg. `eigenanteil` und `teilbetrag` duerfen mehrfach
-- auftreten -- eine zweite `voll` ist eine Doppelzahlung, und die faellt
-- niemandem auf, weil beide Zeilen fuer sich richtig aussehen.
create unique index zahlung_einmal_voll_idx on zahlung (dokument_id)
  where art = 'voll';

comment on table zahlung is
  'Ein Beleg kann mehrere Zahlungen haben: `voll` im regulaeren Durchlauf, '
  '`eigenanteil` nach Rueckkehr aus dem Versicherungs-Nebenlauf (Konzept '
  '13.1). Die Summenpruefung gegen den Rechnungsbetrag laeuft deshalb ueber '
  'die Kontierung und NICHT ueber diese Tabelle.';

comment on column zahlung.rueckmeldung is
  'Bleibt vorerst leer. Endet die Verantwortung mit der Uebergabe, ist es ein '
  'ungenutztes Feld; kommt spaeter ein Kontoauszugsabgleich, ist der Platz da '
  '(Konzept 12).';

comment on column zahlung.protokoll is
  'Was bei der Uebergabe geschehen ist -- Dateischluessel des Exports, '
  'Empfaenger des Versands, Name des Fremdsystems. Kurz und technisch, keine '
  'personenbezogenen Daten.';


-- ---------------------------------------------------------------------------
-- Teil 3: Die harte Sperre
-- ---------------------------------------------------------------------------

-- Beantwortet in einem Aufruf: Darf dieser Beleg zur Zahlung?
--
-- Die Reihenfolge der Pruefungen ist die Reihenfolge, in der ein Mensch sie
-- beantwortet haben will -- die erste Antwort ist die, die er lesen soll.
-- Deshalb ein Hindernis und nicht eine Liste.
create or replace function app.zahlung_moeglich(p_dokument_id uuid)
returns table (moeglich boolean, hindernis text)
language plpgsql
stable
set search_path = public, app
as $$
declare
  lauf         record;
  offene       integer;
  ungueltige   integer;
  hart         text;
  weg          record;
  bank         integer;
begin
  select l.id, l.status, d.status as dokument_status
    into lauf
    from dokument_lauf l
    join dokument d on d.id = l.dokument_id
   where l.dokument_id = p_dokument_id;

  if not found then
    return query select false, 'Zu diesem Beleg laeuft kein Ablauf.'::text;
    return;
  end if;

  if lauf.dokument_status = 'abgelehnt' then
    return query select false, 'Der Beleg ist abgelehnt.'::text;
    return;
  end if;

  -- 1. Gueltige Stempel. Zuerst, weil eine nachtraegliche Aenderung alle
  --    weiteren Pruefungen bedeutungslos macht: Was hier freigegeben wurde,
  --    war eine andere Rechnung.
  select count(*) into ungueltige
    from app.gueltige_freigaben(lauf.id) g where not g.gueltig;

  if ungueltige > 0 then
    return query select false,
      'Die freigaberelevanten Daten haben sich nach der Freigabe geaendert. '
      'Die betroffenen Stufen muessen erneut durchlaufen werden.'::text;
    return;
  end if;

  -- 2. Jede Pflichtstufe ist durch. Die Zahlungsstufe selbst zaehlt nicht --
  --    sie ist ja gerade die, an der gefragt wird.
  select count(*) into offene
    from aufgabe a
    join prozessstufe s on s.id = a.stufe_id
   where a.lauf_id = lauf.id
     and s.pflicht
     and s.stufentyp <> 'zahlung'
     and a.status not in ('erledigt','entfallen');

  if offene > 0 then
    return query select false,
      'Es sind noch Pflichtstufen offen.'::text;
    return;
  end if;

  -- 3. Summenzwang. Steht auch an der Kontierungsstufe, aber ein Beleg kann
  --    die Stufe passiert haben und danach eine Zeile verloren haben.
  if not coalesce(app.kontierung_summe_stimmt(p_dokument_id), false) then
    return query select false,
      'Die Kontierung ergibt nicht den Rechnungsbetrag.'::text;
    return;
  end if;

  -- 4. Harte Plausibilitaetsbefunde. IBAN passt nicht zum Kreditor und
  --    Dublette stoppen die Bearbeitung, sie faerben nicht nur (Konzept 14).
  select b.hinweis into hart
    from plausibilitaet_befund b
   where b.dokument_id = p_dokument_id and b.schwere = 'hart'
   order by b.erkannt_am
   limit 1;

  if hart is not null then
    return query select false, hart;
    return;
  end if;

  -- 5. Bankdaten, wenn der Weg sie verlangt. Die Pruefung laeuft VOR der
  --    Wegewahl: unvollstaendige Daten fuehren zur Sperre, nicht zu einer
  --    fehlgeschlagenen Uebergabe (Konzept 12).
  select z.* into weg
    from dokument d
    join objekt o on o.id = d.objekt_id
    join zahlungsweg z on z.id = o.zahlungsweg_id
   where d.id = p_dokument_id;

  if not found then
    return query select false,
      'Am Objekt ist kein Zahlungsweg hinterlegt.'::text;
    return;
  end if;

  if not weg.aktiv then
    return query select false,
      ('Der Zahlungsweg "' || weg.name || '" ist nicht aktiv.')::text;
    return;
  end if;

  if weg.bankdaten_pflicht then
    select count(*) into bank
      from rechnung_fakten f
      join kreditor_bankverbindung kb on kb.kreditor_id = f.kreditor_id
     where f.dokument_id = p_dokument_id and kb.status = 'verifiziert';

    if bank = 0 then
      return query select false,
        'Es gibt keine verifizierte Bankverbindung zum Kreditor.'::text;
      return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;

comment on function app.zahlung_moeglich(uuid) is
  'Die harte Sperre vor der Zahlung (Konzept 8.2 und 12). Liefert das erste '
  'Hindernis, nicht alle -- der Bearbeiter soll wissen, was als naechstes zu '
  'tun ist, nicht eine Mangelliste lesen.';


-- ---------------------------------------------------------------------------
-- Teil 4: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table zahlung enable row level security;

create policy zahlung_sicht on zahlung for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

grant select, insert, update on zahlung to dms_app;
grant execute on function app.gueltige_freigaben(uuid) to dms_app;
grant execute on function app.freigaben_nachpruefen(uuid) to dms_app;
grant execute on function app.zahlung_moeglich(uuid) to dms_app;

-- Kein delete: Eine Zahlung wird nicht entfernt. Was nicht uebergeben werden
-- soll, bekommt eine Rueckmeldung -- geloescht wird nichts (Konzept 5).
