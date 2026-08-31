-- Lesen und Schreiben am Dokument trennen
--
-- Zweiter Fund aus dem Lernspeicher, und er haengt am selben Punkt wie der
-- erste.
--
-- Die Policy war "for all" mit einer Lesebedingung (Objektsichtbarkeit) und
-- einer Schreibbedingung (nur Mandant). PostgreSQL wendet bei "for all" die
-- USING-Bedingung jedoch auch auf die neue Zeile eines UPDATE an. Die Folge:
-- Ein Beleg liess sich nur einem Objekt zuordnen, fuer das der Bearbeiter
-- selbst zustaendig ist.
--
-- Das macht die Zuordnungsstufe aus Konzept 13 unbenutzbar: Wer die
-- Eingangspost sortiert, ordnet Belege gerade den Objekten der Kollegen zu.
-- Aufgefallen ist es erst, als die Korrektur des Lernspeichers einen Beleg
-- auf ein fremdes Objekt setzen wollte.
--
-- Getrennte Policies je Befehl machen den Unterschied ausdruecklich:
--
--   Lesen    -- eigenes Objekt, eigenes Spezialgebiet, oder noch nicht
--               zugeordnet
--   Anlegen  -- innerhalb des Mandanten
--   Aendern  -- was ich sehen darf, darf ich aendern; das Ergebnis muss im
--               Mandanten bleiben
--   Loeschen -- was ich sehen darf
--
-- Die Mandantengrenze steht in jeder der vier Regeln. Sie ist die aeussere
-- Grenze und wird nie gelockert.

drop policy dokument_sicht on dokument;

create policy dokument_lesen on dokument for select
  using (
    mandant_id = app.mein_mandant()
    and (
      objekt_id is null
      or objekt_id = any (app.meine_objekte())
      or spezialgebiet_id = any (app.meine_spezialgebiete())
    )
  );

create policy dokument_anlegen on dokument for insert
  with check (mandant_id = app.mein_mandant());

create policy dokument_aendern on dokument for update
  using (
    mandant_id = app.mein_mandant()
    and (
      objekt_id is null
      or objekt_id = any (app.meine_objekte())
      or spezialgebiet_id = any (app.meine_spezialgebiete())
    )
  )
  with check (mandant_id = app.mein_mandant());

create policy dokument_loeschen on dokument for delete
  using (
    mandant_id = app.mein_mandant()
    and (
      objekt_id is null
      or objekt_id = any (app.meine_objekte())
      or spezialgebiet_id = any (app.meine_spezialgebiete())
    )
  );

comment on policy dokument_aendern on dokument is
  'Wer einen Beleg sehen darf, darf ihn aendern -- auch auf ein Objekt, fuer '
  'das er selbst nicht zustaendig ist. Genau das tut die Zuordnung. Danach '
  'sieht er ihn womoeglich nicht mehr, und das ist richtig so.';
