-- Die Feldsuche als security-definer-Funktion -- gemessen, nicht angenommen.
--
-- Migration 20261001100000 legte Trigramm-Indizes auf Rechnungsnummer,
-- Kreditorname und IBAN an, und `suchen` suchte darueber als
-- `d.id in (select … from rechnung_fakten f where f.rechnungsnummer ilike …
-- union …)`. Gegen eine Million Belege gemessen (docs/messungen.md):
-- 5 bis 8 Sekunden je Suche. Der Plan zeigt, warum: Die Zeilenrechte auf
-- rechnung_fakten (`exists (select 1 from dokument …)`) sind eine
-- Sicherheitsschranke, und unter ihr darf PostgreSQL ein `ilike` nicht in
-- den Index schieben -- `~~*` ist nicht leakproof. Die Indizes standen da
-- und wurden nie benutzt; gesucht wurde in jeder sichtbaren Zeile, mit
-- Rechteprüfung je Zeile.
--
-- Dieselbe Bauart wie app.meine_objekte(): Die Funktion laeuft ohne
-- Zeilenrechte, gibt aber **nur Belegkennungen** zurueck. Welche Belege
-- der Fragende sehen darf, entscheidet weiterhin die Policy auf `dokument`
-- in der aeusseren Abfrage -- die Sicherheitsgrenze bleibt an einer Stelle.
-- Ein Mandantenfilter steht trotzdem in jedem Zweig: Keine Abfrage ohne
-- Mandantenfilter, auch wenn die Kennung allein nichts verriete.
--
-- Die IBAN wird nicht mehr als Teilstueck gesucht: Alle IBANs eines Landes
-- beginnen gleich, und ein Trigramm-Index trennt dann kaum. Gesucht wird
-- die normalisierte IBAN (ohne Leerzeichen, Grossschreibung) **genau** --
-- wer nach einer IBAN sucht, hat sie vom Kontoauszug kopiert. Ein
-- Anfangsvergleich (`like p || '%'`) wurde gemessen und verworfen: In
-- einer security-definer-Funktion ist das Muster ein Parameter, der Plan
-- generisch, und der B-Baum bleibt liegen (950 ms gegen 25 ms).

drop index if exists rechnung_fakten_iban_trgm_idx;
create index if not exists rechnung_fakten_iban_norm_idx
  on rechnung_fakten (upper(replace(iban_im_beleg, ' ', '')));

create or replace function app.suchtreffer(p_begriff text, p_betrag numeric, p_kennung text)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select f.dokument_id
    from rechnung_fakten f
    join dokument d on d.id = f.dokument_id
   where d.mandant_id = app.mein_mandant()
     and f.rechnungsnummer ilike '%' || p_begriff || '%'
  union
  select f.dokument_id
    from rechnung_fakten f
    join kreditor k on k.id = f.kreditor_id
   where k.mandant_id = app.mein_mandant()
     and k.name ilike '%' || p_begriff || '%'
  union
  select sv.dokument_id
    from schriftverkehr_fakten sv
    join dokument d on d.id = sv.dokument_id
   where d.mandant_id = app.mein_mandant()
     and (sv.korrespondent ilike '%' || p_begriff || '%' or sv.betreff ilike '%' || p_begriff || '%')
  union
  select d.id
    from dokument d
    join objekt o on o.id = d.objekt_id
   where d.mandant_id = app.mein_mandant()
     and o.objektnummer = p_begriff
  union
  select s.dokument_id
    from dokument_seite s
    join dokument d on d.id = s.dokument_id
   where d.mandant_id = app.mein_mandant()
     and s.text_tsv @@ websearch_to_tsquery('german', p_begriff)
  union
  select f.dokument_id
    from rechnung_fakten f
    join dokument d on d.id = f.dokument_id
   where p_kennung is not null
     and d.mandant_id = app.mein_mandant()
     and upper(replace(f.iban_im_beleg, ' ', '')) = upper(p_kennung)
  union
  select f.dokument_id
    from rechnung_fakten f
    join dokument d on d.id = f.dokument_id
   where p_betrag is not null
     and d.mandant_id = app.mein_mandant()
     and (f.brutto = p_betrag or f.netto = p_betrag)
$$;

comment on function app.suchtreffer(text, numeric, text) is
  'Belegkennungen, die ein Suchbegriff in Rechnungsnummer, Kreditor, '
  'Korrespondent, Betreff, Objektnummer, IBAN (genau), Betrag (genau) '
  'oder Seitentext trifft. security definer, damit die Indizes greifen; '
  'welche davon der Fragende sehen darf, entscheidet die Policy auf dokument.';

grant execute on function app.suchtreffer(text, numeric, text) to dms_app;
