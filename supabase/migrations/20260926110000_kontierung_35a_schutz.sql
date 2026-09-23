-- Die Angaben nach Paragraf 35a EStG (Konzept 6, 13): Erfassung an der
-- Kontierungszeile -- und derselbe Schutz wie die Zeile selbst.
--
-- `kontierung_35a` steht seit dem Kernschema (haushaltsnahe Dienstleistung
-- oder Handwerkerleistung, Lohnanteil, Fahrt- und Maschinenkosten,
-- Materialanteil, unbar gezahlt). Geschrieben hat sie bisher niemand. Mit
-- der Erfassung in der Kontierungsmaske braucht sie, was `kontierung` hat:
-- Nach der Archivierung ist der Beleg fest, also auch das, was an seinen
-- Zeilen haengt. `app.archiv_satellit_schutz` liest `dokument_id` aus der
-- Zeile -- diese Tabelle hat keine, sie haengt an `kontierung_id`. Deshalb
-- ein eigener Trigger, der den Beleg ueber die Zeile findet, mit derselben
-- Ausnahme: das faellige Loeschen nimmt die Satelliten mit.

create or replace function app.archiv_35a_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
declare
  betroffen uuid;
begin
  select k.dokument_id into betroffen
    from kontierung k
   where k.id = case tg_op when 'DELETE' then old.kontierung_id else new.kontierung_id end;

  if betroffen is not null
     and exists (select 1 from archiv_eintrag a where a.dokument_id = betroffen) then
    if not (tg_op = 'DELETE' and app.loeschung_faellig(betroffen)) then
      raise exception
        'Der Beleg ist archiviert. Kontierung und Rechnungsdaten sind damit '
        'fest (Konzept 19).';
    end if;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger kontierung_35a_archiv_schutz
  before insert or update or delete on kontierung_35a
  for each row execute function app.archiv_35a_schutz();

-- Die Anteile duerfen zusammen den Bruttobetrag der Zeile nicht
-- uebersteigen -- das prueft die Anwendung, weil sie den Betrag der Zeile
-- kennt; hier nur, dass kein Anteil negativ ist.
alter table kontierung_35a
  add constraint kontierung_35a_nicht_negativ
  check (coalesce(lohnanteil, 0) >= 0
     and coalesce(fahrt_maschinenkosten, 0) >= 0
     and coalesce(materialanteil, 0) >= 0);
