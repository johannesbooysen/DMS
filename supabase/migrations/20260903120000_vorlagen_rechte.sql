-- ===========================================================================
-- Vorlagen: Schreiben ist ein eigenes Recht (Konzept 24.2)
-- ===========================================================================
--
-- Dieselbe Luecke wie bei den uebrigen Stammdaten, nur an einer
-- unangenehmeren Stelle: `vorlage_sicht` lautete `for all` mit reinem
-- Mandantenfilter. Jeder Benutzer konnte Betreff und Text der Ausgangspost
-- umschreiben.
--
-- Warum das schwerer wiegt als ein umbenannter Kreditor: Eine Vorlage
-- bestimmt, **was das Haus verlaesst**. Der Zahlungsauftrag an die Bank, die
-- Mail mit dem Einsichtslink, die Abtretungserklaerung an den Versicherer --
-- alle drei entstehen aus einer Zeile in dieser Tabelle. Wer sie aendern
-- kann, aendert, was Dritte lesen, und zwar unter dem Namen des Hauses.
--
-- Die Weissliste im Code (`src/postausgang/vorlagen.ts`) begrenzt, was eine
-- Vorlage einsetzen *kann* -- nicht, wer sie schreiben darf. Das ist die
-- Ergaenzung dazu.

drop policy if exists vorlage_sicht on vorlage;

-- Lesen wie bisher: Wer Ausgangspost sieht, soll auch nachsehen koennen,
-- aus welcher Vorlage sie entstanden ist.
create policy vorlage_lesen on vorlage for select
  using (mandant_id = (select app.mein_mandant()));

create policy vorlage_schreiben on vorlage for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));


-- ---------------------------------------------------------------------------
-- Wer zuletzt geaendert hat, haelt die Datenbank fest
-- ---------------------------------------------------------------------------
--
-- Die Spalten `geaendert_von` und `geaendert_am` gibt es seit der ersten
-- Fassung; gefuellt hat sie niemand. Dasselbe Muster wie bei der
-- Bankverbindung: Die Tatsache haelt der Trigger fest, nicht die Anwendung
-- -- sonst haengt der Nachweis daran, welchen Weg jemand nimmt.
--
-- Bei einer Vorlage ist die Frage nicht theoretisch: Wenn eine Mail an einen
-- Versicherer eine Formulierung enthaelt, die dort niemand erwartet hat,
-- lautet die erste Frage, wer sie hineingeschrieben hat.
create or replace function app.vorlage_aenderung()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'INSERT'
     or new.betreff is distinct from old.betreff
     or new.text is distinct from old.text
     or new.name is distinct from old.name then
    new.geaendert_von := app.mein_benutzer();
    new.geaendert_am  := now();
  end if;
  return new;
end;
$$;

create trigger vorlage_aenderung
  before insert or update on vorlage
  for each row execute function app.vorlage_aenderung();

comment on function app.vorlage_aenderung() is
  'Haelt fest, wer Betreff oder Text zuletzt geaendert hat. Die Spalten gab '
  'es seit der ersten Fassung, gefuellt hat sie niemand -- und bei einer '
  'Formulierung, die aus dem Haus geht, ist "wer hat das geschrieben" die '
  'erste Frage.';
