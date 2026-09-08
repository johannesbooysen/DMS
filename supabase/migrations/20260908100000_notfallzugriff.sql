-- ===========================================================================
-- Notfallzugriff (Konzept 24, Punkt 10)
-- ===========================================================================
--
-- Das Konzept sagt in einem Halbsatz, worum es geht: "Notfallzugriff bei
-- Ausfall des einzigen Zustaendigen -- protokolliert, ohne Rechteaenderung."
-- Der Halbsatz ist die ganze Schwierigkeit.
--
-- DER FALL
--
-- Anna betreut Objekt 42 und liegt zwei Wochen im Krankenhaus. Die
-- Rechnungen dieses Objekts laufen weiter ein, ihre Aufgaben stapeln sich,
-- und niemand sonst sieht sie -- die Objektsichtbarkeit haengt an
-- `objekt_zustaendigkeit` und `benutzer_rolle_objekt`. Skonti verfallen,
-- Fristen laufen ab, und das faellt erst auf, wenn jemand mahnt.
--
-- WARUM NICHT EINFACH EINE ROLLE ZUWEISEN
--
-- Der naheliegende Griff waere: Der Vertretung schnell `bro`-Zeile fuer
-- Objekt 42 anlegen. Das ist bequem und falsch. Danach steht in
-- `benutzer_rolle_objekt` eine Zustaendigkeit, die es fachlich nie gab, und
-- die Frage "wer durfte wann was" -- die dieses Modell an *einer* Stelle
-- beantwortbar haelt -- ist nicht mehr sauber zu beantworten. Ausserdem
-- bleibt so eine Zeile liegen: Niemand nimmt sie zurueck, wenn Anna
-- wiederkommt.
--
-- Deshalb eine eigene Tabelle. Die Rollenvergabe bleibt unberuehrt.
--
-- DIE REGEL: REICHWEITE, NIE ART
--
-- Ein Notfallzugriff erweitert **die Reichweite vorhandener Rechte, nie ihre
-- Art**. Wer stempeln darf, stempelt auch am gedeckten Objekt. Wer nie
-- stempeln durfte, stempelt weiterhin nicht. Das ist die praezise Lesart von
-- "ohne Rechteaenderung": Es entsteht kein neues Recht, nur ein weiterer
-- Geltungsbereich fuer eines, das die Person ohnehin schon hat.
--
-- Vier Aktionen sind ausdruecklich **ausgeschlossen**:
-- `stammdaten_pflegen`, `benutzer_verwalten`, `prozess_konfigurieren` und
-- `notfallzugriff` selbst. Das sind mandantenweite Verwaltungsrechte, keine
-- Arbeit am Objekt -- ihre Reichweite zu erweitern waere sinnlos (sie gelten
-- ohnehin nicht je Objekt) und waere genau die Hintertuer: Wer im Notfall
-- Rollen vergeben darf, gibt sich jedes Recht dauerhaft selbst.
--
-- VIER AUGEN NACHTRAEGLICH, NICHT VORHER
--
-- Eine Freigabe durch einen Zweiten waere sauberer -- und genau dann nicht
-- zu bekommen, wenn es darauf ankommt. Ein Notfallzugriff, der auf eine
-- Bestaetigung wartet, ist keiner. Also: Er wirkt sofort, aber er ist
-- **laut**. Jeder im Mandanten sieht ihn (Lesepolicy ohne Einschraenkung),
-- der Grund ist Pflicht, und das Ende steht von Anfang an fest.
--
-- WAS HIER BEWUSST NICHT ENTSTEHT
--
-- Kein Protokoll jedes einzelnen Belegaufrufs waehrend des Zugriffs. Das
-- waere ein zweites, staendig wachsendes Verzeichnis darueber, wer was
-- gelesen hat -- mit eigenem datenschutzrechtlichem Gewicht, und das Konzept
-- verlangt es nicht. Der Zugriff selbst **ist** der Nachweis: Wer, welches
-- Objekt, aus welchem Grund, in welchem Zeitraum. Was in diesem Fenster
-- sichtbar war, ergibt sich daraus.


-- ---------------------------------------------------------------------------
-- Teil 1: Die neue Aktion
-- ---------------------------------------------------------------------------

alter table rolle_recht drop constraint rolle_recht_aktion_check;

alter table rolle_recht add constraint rolle_recht_aktion_check
  check (aktion in ('ansehen','bearbeiten','kontieren','stempeln',
                    'exportieren','freigeben_einsicht',
                    'prozess_konfigurieren','delegieren',
                    'stammdaten_pflegen','benutzer_verwalten',
                    'notfallzugriff'));

comment on column rolle_recht.aktion is
  'prozess_konfigurieren ist das Recht am Workflow-Baukasten (ADR 0002). '
  'delegieren erlaubt, Aufgaben mit Zeitfenster weiterzugeben -- ohne dabei '
  'Rechte zu uebertragen. stammdaten_pflegen ist das Tagesgeschaeft an '
  'Objekten, Kreditoren und Konten; benutzer_verwalten ist davon getrennt, '
  'weil daraus jedes andere Recht folgt: Wer Rollen vergeben kann, kann '
  'sich jedes Recht selbst geben. notfallzugriff erlaubt, einen befristeten '
  'Zugriff auf ein fremdes Objekt einzurichten -- er erweitert die '
  'Reichweite vorhandener Rechte, nie ihre Art.';


-- ---------------------------------------------------------------------------
-- Teil 2: Die Tabelle
-- ---------------------------------------------------------------------------
--
-- `objekt_id` ist **Pflicht**. Ein Notfallzugriff "auf alles" waere ein
-- Generalschluessel, und den legt irgendwann jemand an und laesst ihn liegen.
-- Wer drei Objekte uebernimmt, legt drei Eintraege an; das ist die Arbeit
-- von einer Minute und haelt den Nachweis genau.

create table notfallzugriff (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- Wer den Zugriff bekommt.
  benutzer_id   uuid not null references benutzer(id),
  objekt_id     uuid not null references objekt(id),
  -- Pflicht und nicht nur formal: Ein Grund von drei Zeichen ist keiner.
  grund         text not null check (length(btrim(grund)) >= 10),
  beginn        timestamptz not null default now(),
  ende          timestamptz not null,
  -- Wer ihn eingerichtet hat -- oft, aber nicht immer, jemand anderes.
  angelegt_von  uuid not null references benutzer(id),
  angelegt_am   timestamptz not null default now(),
  -- Vorzeitig beendet: Anna ist frueher zurueck.
  beendet_am    timestamptz,
  beendet_von   uuid references benutzer(id),

  constraint notfallzugriff_zeitraum check (ende > beginn),
  /*
   * Hoechstens vierzehn Tage. Was laenger dauert, ist kein Notfall mehr,
   * sondern eine Zustaendigkeit -- und die gehoert in
   * `objekt_zustaendigkeit`, wo sie datiert und nachvollziehbar steht.
   * Ohne Obergrenze wird aus dem Notfallzugriff die bequeme Abkuerzung,
   * mit der man sich die Rechtevergabe spart.
   */
  constraint notfallzugriff_hoechstdauer check (ende <= beginn + interval '14 days')
);

comment on table notfallzugriff is
  'Befristeter Zugriff auf ein fremdes Objekt bei Ausfall des Zustaendigen '
  '(Konzept 24.10). Erweitert die Reichweite vorhandener Rechte, nie ihre '
  'Art -- die Rollenvergabe bleibt unberuehrt.';

comment on column notfallzugriff.grund is
  'Sachlich formulieren -- **keine Gesundheitsangaben**. "Vertretung fuer '
  'Objekt 42 waehrend Abwesenheit" genuegt; "liegt mit Bandscheibenvorfall '
  'im Krankenhaus" waere ein Gesundheitsdatum (Art. 9 DSGVO) in einer '
  'Tabelle, die der ganze Mandant liest. Der Grund erklaert den Zugriff, '
  'nicht die Abwesenheit.';

comment on column notfallzugriff.ende is
  'Pflicht und hoechstens 14 Tage nach dem Beginn. Ein Zugriff ohne Ende '
  'waere eine stille Rechteausweitung.';

-- Der Index, den `app.meine_objekte()` und `app.darf()` je Statement
-- benutzen. Beide fragen nach dem Benutzer und dem laufenden Zeitpunkt.
create index notfallzugriff_benutzer_idx
  on notfallzugriff (benutzer_id, objekt_id, ende desc)
  where beendet_am is null;

create index notfallzugriff_objekt_idx on notfallzugriff (objekt_id, beginn desc);


-- ---------------------------------------------------------------------------
-- Teil 3: Unveraenderlich, ausser dem vorzeitigen Ende
-- ---------------------------------------------------------------------------
--
-- Dieselbe Regel wie bei der Objektsperre und beim Loeschprotokoll:
-- null -> Wert ja, Wert -> anderer Wert nein. Alles andere bleibt fest.
-- Ein nachtraeglich verlaengerter oder umgeschriebener Notfallzugriff waere
-- kein Nachweis mehr, sondern eine Erzaehlung.

create or replace function app.notfallzugriff_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Ein Notfallzugriff wird nicht geloescht -- er ist der Nachweis, dass '
      'jemand fremde Belege sehen durfte. Vorzeitig beenden geht.';
  end if;

  if (new.mandant_id, new.benutzer_id, new.objekt_id, new.grund,
      new.beginn, new.ende, new.angelegt_von, new.angelegt_am)
     is distinct from
     (old.mandant_id, old.benutzer_id, old.objekt_id, old.grund,
      old.beginn, old.ende, old.angelegt_von, old.angelegt_am) then
    raise exception
      'Ein Notfallzugriff wird nicht geaendert. Beenden und einen neuen '
      'anlegen -- dann steht der zweite Grund auch da.';
  end if;

  if old.beendet_am is not null and new.beendet_am is distinct from old.beendet_am then
    raise exception 'Ein beendeter Notfallzugriff wird nicht erneut beendet.';
  end if;

  return new;
end;
$$;

create trigger notfallzugriff_unveraenderlich
  before update or delete on notfallzugriff
  for each row execute function app.notfallzugriff_schutz();


-- ---------------------------------------------------------------------------
-- Teil 4: Berechtigungen
-- ---------------------------------------------------------------------------
--
-- **Lesen darf jeder im Mandanten.** Das ist Absicht und der Ersatz fuer die
-- fehlende Vorabfreigabe: Ein Notfallzugriff, den nur der Zugreifende sieht,
-- waere eine leise Hintertuer. Sichtbarkeit ist hier die Kontrolle.
--
-- **Schreiben nur mit `notfallzugriff`.** Getrennt von `benutzer_verwalten`,
-- obwohl beides Rechteverwaltung ist: Die Benutzerverwaltung ist
-- Tagesgeschaeft der Geschaeftsleitung, ein Notfallzugriff ist ein Vorgang
-- mit Begruendungspflicht. Wer nur den einen soll, bekommt nur den einen.

alter table notfallzugriff enable row level security;

create policy notfallzugriff_lesen on notfallzugriff for select
  using (mandant_id = (select app.mein_mandant()));

create policy notfallzugriff_schreiben on notfallzugriff for insert
  with check (
    mandant_id = (select app.mein_mandant())
    and (select app.darf('notfallzugriff'))
  );

-- Beenden darf, wer einrichten darf -- und der Betroffene selbst. Letzteres,
-- damit Anna nach ihrer Rueckkehr nicht auf jemanden warten muss, um den
-- Zugriff auf ihr eigenes Objekt zu schliessen.
create policy notfallzugriff_beenden on notfallzugriff for update
  using (
    mandant_id = (select app.mein_mandant())
    and ((select app.darf('notfallzugriff'))
         or benutzer_id = (select app.mein_benutzer()))
  );

grant select, insert, update on notfallzugriff to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 5: Die Reichweite -- Sichtbarkeit
-- ---------------------------------------------------------------------------
--
-- Hier haengt sich der Notfallzugriff ein, und zwar an **einer** Stelle:
-- `app.meine_objekte()`. Jede objektbezogene Policy im System geht darueber,
-- also wirkt der Zugriff ueberall gleich, ohne dass eine einzige Policy
-- angefasst wird.
--
-- Der Zusatz ist ein dritter `exists`-Zweig neben den beiden vorhandenen --
-- die Funktion bleibt `stable security definer` und wird weiterhin einmal je
-- Statement ausgewertet (siehe die Warnung am Kopf von 20260828100100).

create or replace function app.meine_objekte()
returns uuid[]
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce(array_agg(distinct o.id), '{}'::uuid[])
    from objekt o
   where o.mandant_id = app.mein_mandant()
     and (
       exists (select 1 from objekt_zustaendigkeit z
                where z.objekt_id = o.id
                  and z.benutzer_id = app.mein_benutzer()
                  and z.gueltig_von <= current_date
                  and (z.gueltig_bis is null or z.gueltig_bis >= current_date))
       or exists (select 1
                    from benutzer_rolle_objekt bro
                    join rolle r on r.id = bro.rolle_id and r.aktiv
                    join rolle_recht rr on rr.rolle_id = r.id and rr.aktion = 'ansehen'
                   where bro.benutzer_id = app.mein_benutzer()
                     and (bro.objekt_id = o.id or bro.objekt_id is null)
                     and bro.gueltig_von <= current_date
                     and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date))
       -- Notfallzugriff (Konzept 24.10): befristet, begruendet, sichtbar.
       or exists (select 1 from notfallzugriff n
                   where n.objekt_id = o.id
                     and n.benutzer_id = app.mein_benutzer()
                     and n.beendet_am is null
                     and now() between n.beginn and n.ende)
     );
$$;

comment on function app.meine_objekte() is
  'Wird je Statement einmal ausgewertet, nicht je Zeile. Siehe die Warnung am '
  'Kopf von 20260828100100_rls.sql -- der Unterschied betraegt 2 ms gegen '
  '264 ms. Drei Quellen, alle datiert: Zustaendigkeit, Rollenzuweisung und '
  'befristeter Notfallzugriff.';


-- ---------------------------------------------------------------------------
-- Teil 6: Die Reichweite -- Handeln
-- ---------------------------------------------------------------------------
--
-- Sehen allein genuegt nicht: Wer die Vertretung uebernimmt, soll die
-- liegengebliebenen Aufgaben auch abarbeiten koennen. Deshalb greift der
-- Notfallzugriff ebenso in `app.darf()` -- **aber nur fuer Rechte, die die
-- Person anderswo bereits hat**, und nie fuer die vier Verwaltungsaktionen.
--
-- Ohne `p_objekt_id` wirkt er gar nicht: Ein Notfallzugriff gilt je Objekt,
-- und eine Frage ohne Objekt ist keine Frage nach diesem Objekt.

create or replace function app.darf(
  p_aktion            text,
  p_objekt_id         uuid default null,
  p_belegart          text default null,
  p_ordnungsgruppe_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
      from benutzer_rolle_objekt bro
      join rolle r on r.id = bro.rolle_id and r.aktiv
      join rolle_recht rr on rr.rolle_id = r.id
     where bro.benutzer_id = app.mein_benutzer()
       and bro.gueltig_von <= current_date
       and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
       and (p_objekt_id is null or bro.objekt_id = p_objekt_id or bro.objekt_id is null)
       and rr.aktion = p_aktion
       and (rr.belegart is null or rr.belegart = p_belegart)
       and (rr.ordnungsgruppe_id is null or rr.ordnungsgruppe_id = p_ordnungsgruppe_id)
  )
  or (
    -- Notfallzugriff: dieselben Rechte, weitere Reichweite.
    p_objekt_id is not null
    and p_aktion not in ('stammdaten_pflegen', 'benutzer_verwalten',
                         'prozess_konfigurieren', 'notfallzugriff')
    and exists (
      select 1
        from notfallzugriff n
        join benutzer_rolle_objekt bro on bro.benutzer_id = n.benutzer_id
        join rolle r on r.id = bro.rolle_id and r.aktiv
        join rolle_recht rr on rr.rolle_id = r.id
       where n.benutzer_id = app.mein_benutzer()
         and n.objekt_id = p_objekt_id
         and n.beendet_am is null
         and now() between n.beginn and n.ende
         and bro.gueltig_von <= current_date
         and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
         and rr.aktion = p_aktion
         and (rr.belegart is null or rr.belegart = p_belegart)
         and (rr.ordnungsgruppe_id is null or rr.ordnungsgruppe_id = p_ordnungsgruppe_id)
    )
  );
$$;

comment on function app.darf(text, uuid, text, uuid) is
  'Vereinigung ueber alle Rollen des Benutzers: mehrere Rollen ergaenzen '
  'sich. Ein Recht wird nie durch eine zweite Rolle entzogen -- eine '
  'Verbotsregel waere im Rechtemodell nicht mehr nachvollziehbar zu machen. '
  'Ein laufender Notfallzugriff (Konzept 24.10) erweitert die **Reichweite** '
  'vorhandener Rechte auf das gedeckte Objekt, nie ihre Art: Wer nie '
  'stempeln durfte, stempelt auch im Notfall nicht. Die vier '
  'Verwaltungsaktionen sind ausgenommen.';


-- ---------------------------------------------------------------------------
-- Teil 7: Auskunft
-- ---------------------------------------------------------------------------

-- Was gerade laeuft -- fuer das Band ueber der Oberflaeche.
--
-- **`security definer` mit handgeschriebenem Mandantenfilter**, wie
-- `app.loeschkandidaten`. Der naheliegende Entwurf ohne kam nicht weit: Die
-- Funktion verbindet auf `objekt`, und dessen RLS liesse genau die Zeilen
-- verschwinden, die jemand kontrollieren soll -- man saehe einen
-- Notfallzugriff nur auf Objekte, die man ohnehin sieht. Sichtbarkeit ist
-- hier aber der Ersatz fuer die Vorabfreigabe, die im Notfall niemand geben
-- kann; eine Kontrolle, die nur den ohnehin Berechtigten offensteht, ist
-- keine.
--
-- Herausgegeben werden Objektnummer, Name, Grund und Zeitraum -- keine
-- Belege, keine Betraege. Der Mandantenfilter steht von Hand darin und ist
-- die einzige Grenze, die diese Funktion kennt.
create or replace function app.notfallzugriff_offen()
returns table (
  id           uuid,
  benutzer_id  uuid,
  benutzer     text,
  objekt_id    uuid,
  objektnummer text,
  objektname   text,
  grund        text,
  beginn       timestamptz,
  ende         timestamptz,
  eigener      boolean
)
language sql
stable
security definer
set search_path = public, app
as $$
  select n.id, n.benutzer_id, b.name, n.objekt_id, o.objektnummer, o.bezeichnung,
         n.grund, n.beginn, n.ende,
         n.benutzer_id = app.mein_benutzer() as eigener
    from notfallzugriff n
    join benutzer b on b.id = n.benutzer_id
    join objekt o on o.id = n.objekt_id
   where n.mandant_id = app.mein_mandant()
     and n.beendet_am is null
     and now() between n.beginn and n.ende
   order by n.beginn desc;
$$;

grant execute on function app.notfallzugriff_offen() to dms_app;

comment on function app.notfallzugriff_offen() is
  'Laufende Notfallzugriffe des Mandanten. Bewusst fuer alle sichtbar: Die '
  'Sichtbarkeit ersetzt die Vorabfreigabe, die im Notfall niemand geben '
  'kann.';
