-- Objekt ueber seine Anschrift im Belegtext finden.
--
-- Beim Bedienen: Eine Versorgerrechnung nennt die Liegenschaft im Klartext
-- ("Lindenweg 3"), und trotzdem blieb der Beleg ohne Objekt, weil nur
-- **gelernte** Merkmale zaehlten und beim ersten Beleg nichts gelernt ist.
-- Die Anschrift des Objekts ist ein Stammdatum und damit so deterministisch
-- wie eine Kundennummer (Konzept 15, Merkmalstyp liegenschaftsadresse).
--
-- Security definer aus demselben Grund wie app.zuordnungstreffer
-- (20260831150000): Die Suche muss auch Objekte finden, die der Einliefernde
-- nicht sehen darf -- sonst waere dieselbe Zuordnung fuer den einen eindeutig
-- und fuer den anderen unmoeglich. Herausgegeben werden nur Nummer und
-- Anschrift des Objekts, und nur fuer Belege des eigenen Hauses.
--
-- Verglichen wird der Teil vor dem ersten Komma (Strasse und Hausnummer),
-- ohne Leerzeichen und Klein-/Grossschreibung; kuerzer als sechs Zeichen
-- zaehlt nicht ("Am Markt 1" trifft sonst jede zweite Rechnung).

create or replace function app.objekte_im_text(p_dokument_id uuid)
returns table (objekt_id uuid, objektnummer text, adresse text)
language sql
stable
security definer
set search_path = public, app
as $$
  with beleg as (
    select d.mandant_id,
           lower(regexp_replace(coalesce(string_agg(s.text, ' '), ''), '\s+', '', 'g')) as text
      from dokument d
      left join dokument_seite s on s.dokument_id = d.id
     where d.id = p_dokument_id
       and d.mandant_id = app.mein_mandant()
     group by d.mandant_id
  ),
  objekte as (
    select o.id, o.objektnummer, o.adresse,
           lower(regexp_replace(split_part(o.adresse, ',', 1), '\s+', '', 'g')) as strasse
      from objekt o, beleg b
     where o.mandant_id = b.mandant_id and o.aktiv
  )
  select o.id, o.objektnummer, o.adresse
    from objekte o, beleg b
   where length(o.strasse) >= 6
     and position(o.strasse in b.text) > 0
   order by o.objektnummer;
$$;

grant execute on function app.objekte_im_text(uuid) to dms_app;
