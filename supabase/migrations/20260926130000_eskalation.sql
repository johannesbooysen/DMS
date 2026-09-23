-- Eskalation (Konzept 8, 17): Eine Aufgabe, die ueber der Frist liegt,
-- wandert -- die Rolle bleibt.
--
-- `prozessstufe.eskalation_nach_stunden` und `eskalation_an` standen seit
-- dem Kernschema, `aufgabe.eskalationsstufe` ebenso. Gelesen hat sie
-- niemand: Eine ueberfaellige Aufgabe stand rot im Postfach und blieb dort.
-- Der Durchgang unten ist die Stelle, die fehlte. Er laeuft im Worker,
-- ohne Benutzer -- deshalb `security definer`, wie `benachrichtigung_faellig`.
--
-- **Was er tut:** Ist eine offene Aufgabe laenger als `eskalation_nach_stunden`
-- ueber ihrer Faelligkeit (ohne Faelligkeit: ueber ihrer Entstehung), bekommt
-- die an der Stufe hinterlegte Person sie persoenlich zugewiesen; die
-- Zuweisung an Gruppe oder Rolle bleibt daneben stehen, damit der Pool sie
-- weiterhin sieht. `eskalationsstufe` geht auf 1 -- genau einmal, nie im
-- Kreis. Der Vorgang steht in `zuweisung_ereignis` mit Grund `eskalation`.
--
-- **Was er nicht tut:** Rechte uebertragen. Wer die Aufgabe bekommt, darf
-- nur, was seine Rollen hergeben (Konzept 17: "Vertretung laeuft nicht
-- ueber Rechteuebertragung, sondern ueber die Eskalation").
--
-- `zuweisung_ereignis.von_benutzer` wird dafuer optional: Eine Aufgabe aus
-- dem Pool hatte niemanden, von dem sie kaeme.

alter table zuweisung_ereignis alter column von_benutzer drop not null;

comment on column zuweisung_ereignis.von_benutzer is
  'Leer, wenn die Aufgabe vorher niemandem persoenlich gehoerte (Pool).';

create or replace function app.eskalation_durchgang()
returns table (aufgabe_id uuid, dokument_id uuid, an_benutzer uuid)
language sql
security definer
set search_path = public, app
as $$
  with faellig as (
    select a.id, a.zugewiesen_benutzer, s.eskalation_an, l.dokument_id
      from aufgabe a
      join prozessstufe s on s.id = a.stufe_id
      join dokument_lauf l on l.id = a.lauf_id
      join benutzer b on b.id = s.eskalation_an and b.aktiv
     where a.status in ('offen','in_arbeit')
       and a.eskalationsstufe = 0
       and s.eskalation_nach_stunden is not null
       and coalesce(a.faellig_am, a.erstellt_am)
           + (s.eskalation_nach_stunden * interval '1 hour') < now()
       -- Wer die Aufgabe schon hat, bekommt sie nicht noch einmal.
       and (a.zugewiesen_benutzer is null or a.zugewiesen_benutzer <> s.eskalation_an)
  ),
  umgelenkt as (
    update aufgabe a
       set zugewiesen_benutzer = f.eskalation_an,
           eskalationsstufe = 1
      from faellig f
     where a.id = f.id
     returning a.id, f.dokument_id, f.zugewiesen_benutzer as von, f.eskalation_an as an
  ),
  protokoll as (
    insert into zuweisung_ereignis (dokument_id, von_benutzer, an_benutzer, grund)
    select u.dokument_id, u.von, u.an, 'eskalation' from umgelenkt u
  )
  select u.id, u.dokument_id, u.an from umgelenkt u;
$$;

comment on function app.eskalation_durchgang() is
  'Ueberfaellige Aufgaben an die an der Stufe hinterlegte Person -- einmal, '
  'protokolliert in zuweisung_ereignis. Laeuft im Worker ohne Benutzer.';

grant execute on function app.eskalation_durchgang() to dms_app;
