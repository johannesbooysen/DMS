-- ---------------------------------------------------------------------------
-- Gespeicherte Suchen -- Amagnos "eigener Magnet" fuer den Alltag
-- ---------------------------------------------------------------------------
--
-- Im abzuloesenden System legt sich jeder Anwender eigene Magneten an:
-- "Versicherungsschaeden Objekt 42", "alles Rote". Das ist bequem -- und dort
-- die Quelle der Unordnung, weil ein Magnet zugleich Ablauf sein kann. Hier
-- bleibt beides getrennt: Eine gespeicherte Suche ist ein **Filter mit
-- Namen**, sonst nichts. Sie schiebt keinen Beleg, sie zeigt ihn.
--
-- **Persoenlich.** Eine Suche gehoert dem, der sie gespeichert hat; niemand
-- sonst sieht sie. Eine geteilte Suche waere ein zweiter Weg, Belege zu
-- praesentieren, und der muesste dieselben Fragen beantworten wie ein
-- Postfach -- wer, warum, seit wann. Das ist Stufenuebersicht und Postfach,
-- nicht ein Filter.
--
-- Der Filter ist jsonb mit den Schluesseln der Belegliste (Weissliste in
-- src/belege/suchen-speichern.ts). Was die Liste nicht kennt, wird beim
-- Speichern verworfen -- eine Suche mit einem Schluessel, den niemand
-- auswertet, sieht gespeichert aus und filtert nicht.

create table gespeicherte_suche (
  id           uuid primary key default gen_random_uuid(),
  mandant_id   uuid not null references mandant(id),
  benutzer_id  uuid not null references benutzer(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  filter       jsonb not null default '{}'::jsonb check (jsonb_typeof(filter) = 'object'),
  erstellt_am  timestamptz not null default now(),
  unique (benutzer_id, name)
);

comment on table gespeicherte_suche is
  'Ein Filter der Belegliste mit Namen, persoenlich. Zeigt Belege, schiebt '
  'keine -- der Unterschied zum Magneten des Vorgaengersystems.';

alter table gespeicherte_suche enable row level security;

-- Nur die eigenen: lesen, anlegen, aendern, loeschen. Der Mandantenfilter
-- steht trotzdem dabei -- ein Benutzer gehoert zu einem Haus, und die
-- Bedingung soll das sagen, nicht voraussetzen.
create policy gespeicherte_suche_eigene on gespeicherte_suche for all
  using (benutzer_id = app.mein_benutzer() and mandant_id = (select app.mein_mandant()))
  with check (benutzer_id = app.mein_benutzer() and mandant_id = (select app.mein_mandant()));

grant select, insert, update, delete on gespeicherte_suche to dms_app;
