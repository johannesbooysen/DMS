-- ===========================================================================
-- Schreibrechte an den Stammdaten (Konzept 17)
-- ===========================================================================
--
-- WAS HIER BEHOBEN WIRD
--
-- Die Policies auf den Stammdatentabellen lauteten `for all` mit einem
-- reinen Mandantenfilter. Lesen und Schreiben waren damit dasselbe Recht:
-- Wer den Mandanten sehen durfte, durfte darin alles aendern.
--
-- Nachgestellt mit Anna, einer Objektbearbeiterin mit Zustaendigkeit fuer
-- genau ein Objekt:
--
--   * Sie weist sich selbst die Rolle Geschaeftsleitung zu.
--     `app.darf('prozess_konfigurieren')` springt von false auf true.
--   * Sie fuegt ihrer eigenen Rolle beliebige Rechte hinzu.
--   * Sie markiert eine Bankverbindung als `verifiziert`.
--   * Sie sperrt andere Benutzer.
--   * Sie legt Objekte an und benennt Rollen um.
--
-- Der erste Punkt ist eine vollstaendige Rechteausweitung: Das Rechtemodell
-- aus Konzept 17 war damit eine Empfehlung, keine Grenze. Der dritte hebt
-- den Betrugsschutz auf -- `app.zahlung_moeglich` verlangt eine verifizierte
-- Bankverbindung, und wer selbst verifizieren kann, hat die Sperre nicht.
--
-- Aufgefallen ist es beim Bauen der Stammdatenpflege: Fuer eine Oberflaeche
-- war zu klaeren, wer sie benutzen darf -- und die Antwort war "alle".
--
-- ZWEI RECHTE, NICHT EINES
--
-- `stammdaten_pflegen` und `benutzer_verwalten` sind getrennt, weil sie
-- Verschiedenes bedeuten. Einen Kreditor anzulegen ist Tagesgeschaeft der
-- Buchhaltung. Rollen zu vergeben ist es nicht: Wer das darf, kann sich
-- jedes andere Recht selbst geben, und damit ist es *das* Recht, aus dem
-- alle anderen folgen. Beides in einen Topf zu werfen hiesse, der
-- Buchhaltung nebenbei die Benutzerverwaltung zu geben.
--
-- WARUM `for select` UND `for insert/update/delete` GETRENNT
--
-- Eine Policy `for all` mit einer Schreibbedingung wuerde auch das Lesen
-- einschraenken -- niemand sieht mehr einen Kreditor, ohne ihn aendern zu
-- duerfen. Deshalb bleibt das Lesen, wie es war, und daneben tritt eine
-- eigene Schreibregel.


-- ---------------------------------------------------------------------------
-- Teil 1: Die beiden neuen Aktionen
-- ---------------------------------------------------------------------------

alter table rolle_recht drop constraint rolle_recht_aktion_check;

alter table rolle_recht add constraint rolle_recht_aktion_check
  check (aktion in ('ansehen','bearbeiten','kontieren','stempeln',
                    'exportieren','freigeben_einsicht',
                    'prozess_konfigurieren','delegieren',
                    'stammdaten_pflegen','benutzer_verwalten'));

comment on column rolle_recht.aktion is
  'prozess_konfigurieren ist das Recht am Workflow-Baukasten (ADR 0002). '
  'delegieren erlaubt, Aufgaben mit Zeitfenster weiterzugeben -- ohne dabei '
  'Rechte zu uebertragen. stammdaten_pflegen ist das Tagesgeschaeft an '
  'Objekten, Kreditoren und Konten; benutzer_verwalten ist davon getrennt, '
  'weil daraus jedes andere Recht folgt: Wer Rollen vergeben kann, kann '
  'sich jedes Recht selbst geben.';


/*
 * Ein Kurzweg fuer die Policies.
 *
 * `app.darf('stammdaten_pflegen')` waere ebenso richtig, aber diese
 * Funktionen stehen in jeder Schreibbedingung von zwoelf Tabellen -- und
 * ein Tippfehler in einer Zeichenkette faellt dort nicht auf, sondern
 * oeffnet still eine Tabelle. Als benannte Funktion faellt er beim Anlegen
 * der Policy auf.
 */
create or replace function app.darf_stammdaten()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$ select app.darf('stammdaten_pflegen'); $$;

create or replace function app.darf_benutzer()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$ select app.darf('benutzer_verwalten'); $$;

comment on function app.darf_stammdaten() is
  'Darf der Handelnde Stammdaten pflegen? Als benannte Funktion und nicht '
  'als Zeichenkette in zwoelf Policies: Ein Tippfehler in einer Policy '
  'oeffnet still eine Tabelle, ein falscher Funktionsname faellt beim '
  'Anlegen auf.';

grant execute on function app.darf_stammdaten() to dms_app;
grant execute on function app.darf_benutzer() to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 2: Fachliche Stammdaten -- Lesen wie bisher, Schreiben mit Recht
-- ---------------------------------------------------------------------------
--
-- Je Tabelle wird die bisherige `for all`-Policy durch eine Lesepolicy und
-- eine Schreibpolicy ersetzt. Die Lesebedingung bleibt Wort fuer Wort, wie
-- sie war -- sonst waere dies nebenbei eine Aenderung der Sichtbarkeit, und
-- die gehoerte in eine eigene Migration.
--
-- Unkorrelierte Unterabfragen (`(select ...)`), wie in 20260831210000
-- gemessen: Im Zeilenfilter ruft PostgreSQL eine `stable`-Funktion sonst je
-- Zeile auf.

-- Objekt. Lesen ueber die Zustaendigkeit, Schreiben nur mit Recht.
drop policy if exists objekt_sicht on objekt;
create policy objekt_lesen on objekt for select
  using (id = any ((select app.meine_objekte())::uuid[]));
create policy objekt_schreiben on objekt for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

-- Kreditor.
drop policy if exists kreditor_sicht on kreditor;
create policy kreditor_lesen on kreditor for select
  using (mandant_id = (select app.mein_mandant()));
create policy kreditor_schreiben on kreditor for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

/*
 * Bankverbindungen -- der Betrugsschutz.
 *
 * `app.zahlung_moeglich` verlangt eine **verifizierte** Bankverbindung, und
 * die harte Rot-Pruefung "IBAN gehoert zum bekannten Kreditor" haengt an
 * derselben Tabelle. Wer hier schreiben darf, entscheidet damit, wohin Geld
 * fliesst -- das ist die wertvollste Zeile im ganzen Schema.
 *
 * Neue IBANs entstehen weiterhin von selbst (der Ingest legt sie mit
 * `neu` an); das Verifizieren ist die Handlung, die geschuetzt gehoert, und
 * dafuer gibt es unten `app.bankverbindung_verifizieren`.
 */
drop policy if exists kreditor_bankverbindung_sicht on kreditor_bankverbindung;
create policy bankverbindung_lesen on kreditor_bankverbindung for select
  using (exists (select 1 from kreditor k where k.id = kreditor_id));
create policy bankverbindung_schreiben on kreditor_bankverbindung for all
  using ((select app.darf_stammdaten())
         and exists (select 1 from kreditor k where k.id = kreditor_id))
  with check ((select app.darf_stammdaten())
              and exists (select 1 from kreditor k where k.id = kreditor_id));

-- Konten und Kontenrahmen.
drop policy if exists konto_sicht on konto;
create policy konto_lesen on konto for select
  using (exists (select 1 from kontenrahmen r where r.id = kontenrahmen_id));
create policy konto_schreiben on konto for all
  using ((select app.darf_stammdaten())
         and exists (select 1 from kontenrahmen r where r.id = kontenrahmen_id))
  with check ((select app.darf_stammdaten())
              and exists (select 1 from kontenrahmen r where r.id = kontenrahmen_id));

drop policy if exists kontenrahmen_sicht on kontenrahmen;
create policy kontenrahmen_lesen on kontenrahmen for select
  using (mandant_id = (select app.mein_mandant()));
create policy kontenrahmen_schreiben on kontenrahmen for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

-- Ordnungsgruppen und Spezialgebiete.
drop policy if exists ordnungsgruppe_sicht on ordnungsgruppe;
create policy ordnungsgruppe_lesen on ordnungsgruppe for select
  using (mandant_id = (select app.mein_mandant()));
create policy ordnungsgruppe_schreiben on ordnungsgruppe for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

drop policy if exists spezialgebiet_sicht on spezialgebiet;
create policy spezialgebiet_lesen on spezialgebiet for select
  using (mandant_id = (select app.mein_mandant()));
create policy spezialgebiet_schreiben on spezialgebiet for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

-- Zahlungswege.
drop policy if exists zahlungsweg_sicht on zahlungsweg;
create policy zahlungsweg_lesen on zahlungsweg for select
  using (mandant_id = (select app.mein_mandant()));
create policy zahlungsweg_schreiben on zahlungsweg for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

-- Aufbewahrungsfristen. Sie entscheiden, wie lange ein Beleg liegt --
-- eine zu kurze Frist loescht Belege, die noch aufzubewahren waeren.
drop policy if exists aufbewahrungsfrist_sicht on aufbewahrungsfrist;
create policy aufbewahrungsfrist_lesen on aufbewahrungsfrist for select
  using (mandant_id = (select app.mein_mandant()));
create policy aufbewahrungsfrist_schreiben on aufbewahrungsfrist for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));


-- ---------------------------------------------------------------------------
-- Teil 3: Benutzer und Rollen -- das Recht, aus dem alle anderen folgen
-- ---------------------------------------------------------------------------

drop policy if exists benutzer_sicht on benutzer;
create policy benutzer_lesen on benutzer for select
  using (mandant_id = (select app.mein_mandant()));
create policy benutzer_schreiben on benutzer for all
  using ((select app.darf_benutzer()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_benutzer()) and mandant_id = (select app.mein_mandant()));

drop policy if exists rolle_sicht on rolle;
create policy rolle_lesen on rolle for select
  using (mandant_id = (select app.mein_mandant()));
create policy rolle_schreiben on rolle for all
  using ((select app.darf_benutzer()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_benutzer()) and mandant_id = (select app.mein_mandant()));

drop policy if exists rolle_recht_sicht on rolle_recht;
create policy rolle_recht_lesen on rolle_recht for select
  using (exists (select 1 from rolle r where r.id = rolle_id));
create policy rolle_recht_schreiben on rolle_recht for all
  using ((select app.darf_benutzer()) and exists (select 1 from rolle r where r.id = rolle_id))
  with check ((select app.darf_benutzer())
              and exists (select 1 from rolle r where r.id = rolle_id));

/*
 * Die Rollenzuweisung -- der eigentliche Fund.
 *
 * Hier stand die Luecke, durch die eine Objektbearbeiterin sich die
 * Geschaeftsleitung geben konnte. Lesen bleibt offen (wer welche Rolle
 * traegt, ist im Haus keine Geheimnis und steht in jeder Aufgabenliste),
 * Schreiben braucht `benutzer_verwalten`.
 */
drop policy if exists benutzer_rolle_objekt_sicht on benutzer_rolle_objekt;
create policy benutzer_rolle_objekt_lesen on benutzer_rolle_objekt for select
  using (exists (select 1 from benutzer b where b.id = benutzer_id));
create policy benutzer_rolle_objekt_schreiben on benutzer_rolle_objekt for all
  using ((select app.darf_benutzer())
         and exists (select 1 from benutzer b where b.id = benutzer_id))
  with check ((select app.darf_benutzer())
              and exists (select 1 from benutzer b where b.id = benutzer_id));


-- ---------------------------------------------------------------------------
-- Teil 4: Verifizieren ist eine Handlung, kein Feld
-- ---------------------------------------------------------------------------
--
-- Eine Bankverbindung zu verifizieren heisst zu erklaeren: "Ich habe
-- geprueft, dass dieses Konto zu diesem Kreditor gehoert." Das ist der
-- Betrugsschutz aus Konzept 14, und es ist eine Aussage einer Person --
-- kein Wert, den man in einem Formular umstellt.
--
-- Deshalb eine eigene Funktion statt eines Feldes in einer Maske: Sie haelt
-- fest, **wer** wann verifiziert hat. Ohne diese Spuren waere die
-- Verifizierung im Schadensfall nicht mehr zuzuordnen -- und genau danach
-- wuerde dann gefragt.
create or replace function app.bankverbindung_verifizieren(
  p_id uuid,
  p_verifiziert boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  betroffen integer;
begin
  if not app.darf('stammdaten_pflegen') then
    raise exception
      'Bankverbindungen zu verifizieren ist Teil der Stammdatenpflege. '
      'Dieses Recht fehlt.';
  end if;

  update kreditor_bankverbindung b
     set status         = case when p_verifiziert then 'verifiziert' else 'gesperrt' end,
         bestaetigt_von = app.mein_benutzer(),
         bestaetigt_am  = now()
   where b.id = p_id
     -- Der Mandantenfilter von Hand, weil `security definer` die RLS
     -- umgeht. Ohne ihn liesse sich jede Bankverbindung jedes Mandanten
     -- verifizieren -- die schlimmste denkbare Stelle dafuer.
     and exists (
       select 1 from kreditor k
        where k.id = b.kreditor_id and k.mandant_id = app.mein_mandant()
     );

  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;

comment on function app.bankverbindung_verifizieren(uuid, boolean) is
  'Bestaetigt oder sperrt eine Bankverbindung und haelt fest, wer es war. '
  'Eine eigene Funktion und kein Feld in einer Maske: Das ist eine Aussage '
  'einer Person (Betrugsschutz, Konzept 14), und im Schadensfall wird '
  'gefragt, wer sie getroffen hat. Mandantenfilter von Hand, weil '
  'security definer die RLS umgeht.';

grant execute on function app.bankverbindung_verifizieren(uuid, boolean) to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 5: Wer darf heute was -- als Befund, nicht als Vermutung
-- ---------------------------------------------------------------------------
--
-- Nach dieser Migration hat **niemand** die neuen Rechte, bis sie einer
-- Rolle zugeordnet werden. Das ist die richtige Richtung -- ein Recht, das
-- versehentlich bei allen landet, faellt nie auf --, aber es heisst auch:
-- Ohne den Seed-Eintrag unten kann niemand mehr Stammdaten pflegen.
--
-- Diese Sicht macht das nachpruefbar, statt es zu behaupten.
create or replace function app.rechtetraeger(p_aktion text)
returns table (benutzer_id uuid, name text, rolle text)
language sql
stable
security definer
set search_path = public, app
as $$
  select distinct b.id, b.name, r.name
    from benutzer b
    join benutzer_rolle_objekt bro on bro.benutzer_id = b.id
    join rolle r on r.id = bro.rolle_id and r.aktiv
    join rolle_recht rr on rr.rolle_id = r.id and rr.aktion = p_aktion
   where b.mandant_id = app.mein_mandant()
     and b.aktiv
     and bro.gueltig_von <= current_date
     and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
   order by b.name;
$$;

comment on function app.rechtetraeger(text) is
  'Wer traegt ein Recht -- zum Nachsehen, nicht zum Vermuten. Wichtig nach '
  'jeder Aenderung am Rollenmodell: Ein Recht, das niemand mehr hat, faellt '
  'sonst erst auf, wenn jemand es braucht.';

grant execute on function app.rechtetraeger(text) to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 6: Wer bestaetigt hat, haelt die Datenbank fest -- nicht der Aufrufer
-- ---------------------------------------------------------------------------
--
-- `app.bankverbindung_verifizieren` traegt `bestaetigt_von` ein. Ein
-- direktes `update kreditor_bankverbindung set status = 'verifiziert'` tut
-- es nicht -- und beides steht demselben Benutzer offen. Gemessen: Nach dem
-- direkten Weg blieb die Spalte leer.
--
-- Damit haenge der wichtigste Nachweis des Betrugsschutzes daran, welchen
-- Weg jemand zufaellig nimmt. Dasselbe Muster wie bei der Hash-Kette: Die
-- Tatsache haelt der Trigger fest, nicht die Anwendung.
create or replace function app.bankverbindung_bestaetigung()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if new.status is distinct from old.status then
    new.bestaetigt_von := app.mein_benutzer();
    new.bestaetigt_am  := now();
  end if;
  return new;
end;
$$;

create trigger kreditor_bankverbindung_bestaetigung
  before update on kreditor_bankverbindung
  for each row execute function app.bankverbindung_bestaetigung();

comment on function app.bankverbindung_bestaetigung() is
  'Haelt fest, wer den Status einer Bankverbindung geaendert hat -- gleich '
  'auf welchem Weg. Ohne diesen Trigger blieb bestaetigt_von leer, sobald '
  'jemand statt der Funktion ein direktes update benutzte, und der '
  'wichtigste Nachweis des Betrugsschutzes haette am Zufall gehangen.';
