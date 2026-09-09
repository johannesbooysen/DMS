-- ===========================================================================
-- Wer den Ablauf aendert, aendert wer entscheiden darf
-- ===========================================================================
--
-- Gefunden beim Bau der Berechtigungs-Presets (Konzept 24.13): Presets
-- schreiben `rolle_recht` **und** `stempel_recht`. Beim Nachsehen, welche
-- Policy dabei greift, stellte sich heraus: keine, die etwas prueft.
--
-- NACHGESTELLT, NICHT VERMUTET
--
-- Als Anna (Objektbearbeitung, keine Verwaltungsrechte):
--
--   insert into stempel_recht (stempeltyp_id, rolle_id)
--     values ('<Geschaeftsleitung freigeben>', '<Objektbearbeitung>');
--   -- INSERT 0 1
--
-- Danach durfte ihre eigene Rolle den Freigabestempel der Geschaeftsleitung
-- setzen. Ebenso gelangen `insert into stempeltyp` und `insert into gruppe`.
--
-- WARUM DAS SCHWER WIEGT
--
-- `app.zahlung_moeglich()` haelt eine Zahlung an, bis **gueltige Freigaben**
-- vorliegen. Wer sich das Recht auf den Freigabestempel selbst eintraegt,
-- erzeugt diese Freigaben selbst -- die harte Sperre vor der Zahlung ist
-- damit keine mehr. Ueber die Gruppen geht derselbe Weg noch einmal:
-- `stempel_recht` kennt neben `rolle_id` auch `gruppe_id`, und wer Gruppen
-- anlegen und besetzen kann, besetzt sich selbst.
--
-- Das ist dieselbe Klasse, die 20260903100000 fuer die Stammdatentabellen
-- geschlossen hat: eine einzelne `for all`-Policy mit reinem Mandantenfilter.
-- Damals blieben die Konfigurationstabellen aussen vor, weil der Blick auf
-- Objekte, Kreditoren und Konten lag.
--
-- DIE TRENNUNG
--
-- Zwei Rechte, weil es zwei Fragen sind:
--
--   * **`benutzer_verwalten`** -- wer darf was: `stempel_recht`, `gruppe`,
--     `gruppe_mitglied`. Das ist Rechtevergabe, auch wenn es nicht so heisst.
--   * **`prozess_konfigurieren`** -- welcher Ablauf gilt: `stempeltyp` und
--     die `prozess*`-Tabellen. Das Recht gibt es seit dem Rollenmodell; es
--     stand nur in keiner Policy.
--
-- **Lesen bleibt fuer alle offen.** Wer einen Beleg bearbeitet, hat Grund
-- nachzusehen, welche Stufe als naechstes kommt und wer sie stempeln darf.
-- Verborgen ginge die Frage an einen Kollegen.

-- ---------------------------------------------------------------------------
-- Teil 1: Der dritte Kurzweg
-- ---------------------------------------------------------------------------

create or replace function app.darf_prozess()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$ select app.darf('prozess_konfigurieren'); $$;

grant execute on function app.darf_prozess() to dms_app;

comment on function app.darf_prozess() is
  'Darf der Handelnde den Ablauf konfigurieren? Als benannte Funktion und '
  'nicht als Zeichenkette in neun Policies -- aus demselben Grund wie '
  'app.darf_stammdaten(): Ein Tippfehler in einer Policy oeffnet still eine '
  'Tabelle, ein falscher Funktionsname faellt beim Anlegen auf.';


-- ---------------------------------------------------------------------------
-- Teil 2: Rechtevergabe -- benutzer_verwalten
-- ---------------------------------------------------------------------------

drop policy if exists stempel_recht_sicht on stempel_recht;

create policy stempel_recht_lesen on stempel_recht for select
  using (exists (select 1 from stempeltyp s
                  where s.id = stempeltyp_id
                    and s.mandant_id = (select app.mein_mandant())));

create policy stempel_recht_schreiben on stempel_recht for all
  using ((select app.darf_benutzer())
         and exists (select 1 from stempeltyp s
                      where s.id = stempeltyp_id
                        and s.mandant_id = (select app.mein_mandant())))
  with check ((select app.darf_benutzer())
              and exists (select 1 from stempeltyp s
                           where s.id = stempeltyp_id
                             and s.mandant_id = (select app.mein_mandant())));

drop policy if exists gruppe_sicht on gruppe;

create policy gruppe_lesen on gruppe for select
  using (mandant_id = (select app.mein_mandant()));

create policy gruppe_schreiben on gruppe for all
  using ((select app.darf_benutzer()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_benutzer()) and mandant_id = (select app.mein_mandant()));

drop policy if exists gruppe_mitglied_sicht on gruppe_mitglied;

create policy gruppe_mitglied_lesen on gruppe_mitglied for select
  using (exists (select 1 from gruppe g
                  where g.id = gruppe_id
                    and g.mandant_id = (select app.mein_mandant())));

-- Die Mitgliedschaft ist der zweite Weg zum Stempelrecht (`stempel_recht`
-- kennt `gruppe_id`). Sie gehoert deshalb unter dasselbe Recht wie die
-- Rollenzuweisung, nicht unter die Stammdatenpflege.
create policy gruppe_mitglied_schreiben on gruppe_mitglied for all
  using ((select app.darf_benutzer())
         and exists (select 1 from gruppe g
                      where g.id = gruppe_id
                        and g.mandant_id = (select app.mein_mandant())))
  with check ((select app.darf_benutzer())
              and exists (select 1 from gruppe g
                           where g.id = gruppe_id
                             and g.mandant_id = (select app.mein_mandant())));


-- ---------------------------------------------------------------------------
-- Teil 3: Ablauf -- prozess_konfigurieren
-- ---------------------------------------------------------------------------

drop policy if exists stempeltyp_sicht on stempeltyp;

create policy stempeltyp_lesen on stempeltyp for select
  using (mandant_id = (select app.mein_mandant()));

create policy stempeltyp_schreiben on stempeltyp for all
  using ((select app.darf_prozess()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_prozess()) and mandant_id = (select app.mein_mandant()));

drop policy if exists prozessdefinition_sicht on prozessdefinition;

create policy prozessdefinition_lesen on prozessdefinition for select
  using (mandant_id = (select app.mein_mandant()));

create policy prozessdefinition_schreiben on prozessdefinition for all
  using ((select app.darf_prozess()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_prozess()) and mandant_id = (select app.mein_mandant()));

drop policy if exists prozessstufe_sicht on prozessstufe;

create policy prozessstufe_lesen on prozessstufe for select
  using (exists (select 1 from prozessdefinition p
                  where p.id = definition_id
                    and p.mandant_id = (select app.mein_mandant())));

create policy prozessstufe_schreiben on prozessstufe for all
  using ((select app.darf_prozess())
         and exists (select 1 from prozessdefinition p
                      where p.id = definition_id
                        and p.mandant_id = (select app.mein_mandant())))
  with check ((select app.darf_prozess())
              and exists (select 1 from prozessdefinition p
                           where p.id = definition_id
                             and p.mandant_id = (select app.mein_mandant())));

drop policy if exists prozessknoten_sicht on prozessknoten;

create policy prozessknoten_lesen on prozessknoten for select
  using (exists (select 1 from prozessdefinition p
                  where p.id = definition_id
                    and p.mandant_id = (select app.mein_mandant())));

create policy prozessknoten_schreiben on prozessknoten for all
  using ((select app.darf_prozess())
         and exists (select 1 from prozessdefinition p
                      where p.id = definition_id
                        and p.mandant_id = (select app.mein_mandant())))
  with check ((select app.darf_prozess())
              and exists (select 1 from prozessdefinition p
                           where p.id = definition_id
                             and p.mandant_id = (select app.mein_mandant())));

drop policy if exists prozessstufe_stempeltyp_sicht on prozessstufe_stempeltyp;

create policy prozessstufe_stempeltyp_lesen on prozessstufe_stempeltyp for select
  using (exists (select 1 from prozessstufe s
                   join prozessdefinition p on p.id = s.definition_id
                  where s.id = stufe_id
                    and p.mandant_id = (select app.mein_mandant())));

create policy prozessstufe_stempeltyp_schreiben on prozessstufe_stempeltyp for all
  using ((select app.darf_prozess())
         and exists (select 1 from prozessstufe s
                       join prozessdefinition p on p.id = s.definition_id
                      where s.id = stufe_id
                        and p.mandant_id = (select app.mein_mandant())))
  with check ((select app.darf_prozess())
              and exists (select 1 from prozessstufe s
                            join prozessdefinition p on p.id = s.definition_id
                           where s.id = stufe_id
                             and p.mandant_id = (select app.mein_mandant())));

drop policy if exists prozess_override_sicht on prozess_override;

create policy prozess_override_lesen on prozess_override for select
  using (objekt_id = any ((select app.meine_objekte())::uuid[]));

create policy prozess_override_schreiben on prozess_override for all
  using ((select app.darf_prozess())
         and objekt_id = any ((select app.meine_objekte())::uuid[]))
  with check ((select app.darf_prozess())
              and objekt_id = any ((select app.meine_objekte())::uuid[]));
