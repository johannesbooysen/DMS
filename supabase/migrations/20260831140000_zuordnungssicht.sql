-- Belege ohne Objektzuordnung sichtbar machen
--
-- Gefunden beim Bau des Lernspeichers: Ein Beleg ohne objekt_id war fuer
-- niemanden sichtbar. Die Policy verlangte
--
--     objekt_id = any (app.meine_objekte())
--
-- und das ergibt bei objekt_id IS NULL nicht "false", sondern NULL -- also
-- nicht sichtbar. Fuer jeden. Auch fuer den, der die Zuordnung vornehmen
-- soll.
--
-- Genau in diesem Zustand kommt aber jeder Beleg herein, der nicht schon
-- beim Eingang einem Objekt zugewiesen wurde: Der Mailimport weiss es nicht,
-- der Scanner weiss es nicht, und die Zuordnungsstufe aus Konzept 13 ist
-- ueberhaupt erst dafuer da. Die Stufe waere leer geblieben, und niemand
-- haette gemerkt, warum -- die Belege waren ja da, nur unsichtbar.
--
-- Die Regel: Ein Beleg ohne Objekt ist noch keinem Objekt zurechenbar, also
-- kann die Objektsichtbarkeit auf ihn nicht angewendet werden. Er ist im
-- Mandanten sichtbar, bis er zugeordnet ist -- danach greift die
-- Einschraenkung wie bisher.
--
-- Die Mandantengrenze bleibt davon unberuehrt: Sie ist die aeussere Grenze
-- und gilt in jedem Fall.

drop policy dokument_sicht on dokument;

create policy dokument_sicht on dokument for all
  using (
    mandant_id = app.mein_mandant()
    and (
      -- Noch nicht zugeordnet: sichtbar, damit jemand zuordnen kann.
      objekt_id is null
      or objekt_id = any (app.meine_objekte())
      or spezialgebiet_id = any (app.meine_spezialgebiete())
    )
  )
  with check (mandant_id = app.mein_mandant());

comment on policy dokument_sicht on dokument is
  'Objektsichtbarkeit greift erst, sobald ein Objekt feststeht. Ein Beleg '
  'ohne Zuordnung ist niemandem zurechenbar und muss sichtbar sein, sonst '
  'kann ihn niemand zuordnen (Konzept 13, Stufe Zuordnung).';
