-- Anmeldung: Identitaet, Sitzung, Protokoll
--
-- Bis hierher kam die Benutzerkennung aus der Umgebungsvariable
-- DMS_BENUTZER. Das war ausdruecklich keine Authentifizierung: Wer den
-- Prozess starten konnte, war, wen er behauptete zu sein. Die RLS trug
-- trotzdem von Anfang an -- es fehlte nur die Bruecke von einer echten
-- Sitzung zu app.mein_benutzer().
--
-- Diese Migration baut die Bruecke. Die Entscheidung fuer Entra ID steht in
-- ADR 0004; das Schema haelt sich davon frei, weil der Anbieter austauschbar
-- bleiben muss (Konzept 22, Adapterschicht).
--
-- Zwei Punkte, die spaeter niemand mehr sieht:
--
--   * Die Sitzungssuche muss laufen, **bevor** feststeht, wer fragt. Sie kann
--     deshalb nicht unter der RLS des Benutzers stehen -- das waere ein
--     Zirkelschluss. Sie laeuft ueber `security definer`-Funktionen, und der
--     Schluessel dazu ist der Token, den nur der Browser des Angemeldeten hat.
--   * In der Tabelle steht **nicht** der Token, sondern sein SHA256. Wer die
--     Datenbank liest, kann sich damit nicht anmelden.


-- ---------------------------------------------------------------------------
-- Teil 1: Identitaet am Benutzer
-- ---------------------------------------------------------------------------

-- auth_id war fuer Supabase Auth gedacht und ist nie benutzt worden. An seine
-- Stelle tritt ein Paar aus Anbieter und Kennung: Derselbe Mensch kann bei
-- verschiedenen Anbietern verschiedene Kennungen haben, und die Kennung ist
-- nicht bei jedem Anbieter eine UUID.
alter table benutzer drop column auth_id;

alter table benutzer
  add column anbieter        text,
  add column externe_kennung text,
  add column letzte_anmeldung timestamptz;

-- Teilindex: Benutzer ohne Identitaet sind erlaubt (angelegt, aber noch nie
-- angemeldet), doppelte Identitaeten nicht.
create unique index benutzer_identitaet_idx
  on benutzer (anbieter, externe_kennung)
  where anbieter is not null;

comment on column benutzer.externe_kennung is
  'Beim Anbieter stabile Kennung. Bei Entra ID der Claim `oid` -- nicht `sub` '
  '(anwendungsbezogen und wechselt mit der App-Registrierung) und nicht die '
  'E-Mail (aendert sich bei Heirat, Namenswechsel, Umfirmierung).';

comment on column benutzer.anbieter is
  'Welcher Identitaetsanbieter die Kennung vergeben hat. Ohne diese Spalte '
  'waere eine Kennung aus einem zweiten Anbieter nicht von einer echten zu '
  'unterscheiden.';


-- ---------------------------------------------------------------------------
-- Teil 2: Sitzung
-- ---------------------------------------------------------------------------

create table sitzung (
  id                uuid primary key default gen_random_uuid(),
  benutzer_id       uuid not null references benutzer(id) on delete cascade,
  anbieter          text not null,
  token_hash        bytea not null unique,
  erstellt_am       timestamptz not null default now(),
  letzte_aktivitaet timestamptz not null default now(),
  laeuft_ab_am      timestamptz not null,
  beendet_am        timestamptz,
  beendet_grund     text check (beendet_grund in
                      ('abmeldung','ablauf','untaetigkeit','widerruf'))
);

create index sitzung_benutzer_idx on sitzung (benutzer_id)
  where beendet_am is null;

comment on table sitzung is
  'Serverseitige Sitzung. Bewusst kein selbsttragendes Token (JWT im Cookie): '
  'Eine Sitzung muss sofort widerrufbar sein -- bei Abmeldung, bei Sperrung '
  'eines Benutzers, beim Entzug einer Rolle. Ein JWT gilt bis zum Ablauf '
  'weiter, ein Datenbankeintrag nicht.';

comment on column sitzung.token_hash is
  'SHA256 des Cookie-Tokens, nicht der Token selbst. Wer die Tabelle liest, '
  'kann sich damit nicht anmelden.';

-- Weder IP noch Browserkennung. Beides waere personenbezogen und beides
-- braeuchte eine Aufbewahrungsfrist und eine Begruendung; fuer die Funktion
-- der Sitzung wird es nicht gebraucht. Wenn Missbrauchserkennung dazukommt,
-- ist das eine eigene Entscheidung mit eigener Begruendung -- kein Nebeneffekt
-- dieser Migration.


-- ---------------------------------------------------------------------------
-- Teil 3: Anmeldeprotokoll
-- ---------------------------------------------------------------------------

create table anmelde_ereignis (
  id            bigserial primary key,
  mandant_id    uuid references mandant(id),
  benutzer_id   uuid references benutzer(id) on delete set null,
  zeitpunkt     timestamptz not null default now(),
  ergebnis      text not null check (ergebnis in
                  ('erfolg','unbekannt','gesperrt','abgelehnt','abmeldung')),
  anbieter      text,
  hinweis       text
);

create index anmelde_ereignis_zeit_idx on anmelde_ereignis (zeitpunkt desc);

comment on table anmelde_ereignis is
  'Beantwortet "wer hat sich wann angemeldet" und "hat jemand vergeblich '
  'versucht hereinzukommen". Ergebnis `unbekannt` heisst: Die Identitaet war '
  'gueltig, aber zu ihr gehoert kein Benutzer -- der haeufigste Fall ist ein '
  'neuer Kollege, den noch niemand angelegt hat.';

comment on column anmelde_ereignis.hinweis is
  'Kurzer, technischer Grund. **Keine** E-Mail-Adressen, keine Namen, keine '
  'Tokenteile -- das Protokoll wird laenger aufbewahrt als eine Sitzung '
  '(Konzept 20, und die Projektregel zu Logs).';


-- ---------------------------------------------------------------------------
-- Teil 4: Funktionen
-- ---------------------------------------------------------------------------

-- Loest einen Sitzungstoken auf. `security definer`, weil zum Zeitpunkt des
-- Aufrufs noch niemand angemeldet ist -- app.mein_benutzer() ist leer, und
-- eine RLS-Policy haette nichts, woran sie sich haelt.
--
-- Der Schutz liegt nicht in der RLS, sondern darin, dass der Token nur im
-- Browser des Angemeldeten liegt und in der Datenbank nur sein Hash steht.
create or replace function app.sitzung_aufloesen(
  p_token_hash   bytea,
  p_untaetig_min integer default 480
)
returns table (benutzer_id uuid, mandant_id uuid)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  gefunden record;
begin
  select s.id, s.benutzer_id, s.laeuft_ab_am, s.letzte_aktivitaet,
         b.mandant_id, b.aktiv
    into gefunden
    from sitzung s
    join benutzer b on b.id = s.benutzer_id
   where s.token_hash = p_token_hash
     and s.beendet_am is null;

  if not found then
    return;
  end if;

  -- Abgelaufen oder zu lange untaetig: Die Sitzung wird hier beendet, nicht
  -- nur uebergangen. Sonst haengt sie bis zum naechsten Aufraeumlauf herum
  -- und laesst sich mit einem gestohlenen Token spaeter weiterbenutzen.
  if gefunden.laeuft_ab_am <= now() then
    update sitzung set beendet_am = now(), beendet_grund = 'ablauf'
     where id = gefunden.id;
    return;
  end if;

  if gefunden.letzte_aktivitaet < now() - make_interval(mins => p_untaetig_min) then
    update sitzung set beendet_am = now(), beendet_grund = 'untaetigkeit'
     where id = gefunden.id;
    return;
  end if;

  -- Ein gesperrter Benutzer verliert die laufende Sitzung sofort. Das ist der
  -- Grund fuer die serverseitige Sitzung: Ein JWT haette bis zum Ablauf
  -- weitergegolten.
  if not gefunden.aktiv then
    update sitzung set beendet_am = now(), beendet_grund = 'widerruf'
     where id = gefunden.id;
    return;
  end if;

  update sitzung set letzte_aktivitaet = now() where id = gefunden.id;

  benutzer_id := gefunden.benutzer_id;
  mandant_id  := gefunden.mandant_id;
  return next;
end;
$$;

comment on function app.sitzung_aufloesen(bytea, integer) is
  'Laeuft vor der Anmeldung und deshalb als security definer. Verlaengert '
  'nebenbei die Sitzung und beendet sie, wenn sie abgelaufen, zu lange '
  'untaetig oder der Benutzer gesperrt ist.';


-- Ordnet eine bestaetigte Identitaet einem Benutzer zu.
--
-- Legt **keinen** Benutzer an. Wer im DMS arbeiten darf, entscheidet die
-- Verwaltung, nicht der Identitaetsanbieter -- sonst haette jeder im
-- Microsoft-Mandanten mit dem ersten Anmeldeversuch einen Zugang, und die
-- Rechtevergabe liefe der Anmeldung hinterher.
--
-- Die Verknuepfung entsteht beim ersten Mal ueber die E-Mail-Adresse: Der
-- Benutzer ist angelegt, seine Kennung beim Anbieter aber noch unbekannt.
create or replace function app.identitaet_aufloesen(
  p_anbieter        text,
  p_externe_kennung text,
  p_email           text
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  treffer uuid;
begin
  select id into treffer
    from benutzer
   where anbieter = p_anbieter and externe_kennung = p_externe_kennung;

  if treffer is not null then
    update benutzer set letzte_anmeldung = now() where id = treffer;
    return treffer;
  end if;

  -- Erstanmeldung: ueber die E-Mail an einen vorhandenen Benutzer binden.
  -- Nur, solange dieser noch keine andere Identitaet traegt -- sonst koennte
  -- eine zweite Kennung mit derselben Adresse die erste verdraengen.
  select id into treffer
    from benutzer
   where lower(email) = lower(p_email)
     and anbieter is null
     and aktiv;

  if treffer is null then
    return null;
  end if;

  update benutzer
     set anbieter = p_anbieter,
         externe_kennung = p_externe_kennung,
         letzte_anmeldung = now()
   where id = treffer;

  return treffer;
end;
$$;

comment on function app.identitaet_aufloesen(text, text, text) is
  'Bindet eine bestaetigte Identitaet an einen bereits angelegten Benutzer. '
  'Legt bewusst keinen an: Wer arbeiten darf, entscheidet die Verwaltung, '
  'nicht der Identitaetsanbieter.';


create or replace function app.sitzung_anlegen(
  p_benutzer_id uuid,
  p_token_hash  bytea,
  p_anbieter    text,
  p_dauer_min   integer default 720
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  neue uuid;
  m    uuid;
begin
  select mandant_id into m from benutzer where id = p_benutzer_id and aktiv;
  if m is null then
    return null;
  end if;

  insert into sitzung (benutzer_id, anbieter, token_hash, laeuft_ab_am)
  values (p_benutzer_id, p_anbieter, p_token_hash,
          now() + make_interval(mins => p_dauer_min))
  returning id into neue;

  insert into anmelde_ereignis (mandant_id, benutzer_id, ergebnis, anbieter)
  values (m, p_benutzer_id, 'erfolg', p_anbieter);

  return neue;
end;
$$;


create or replace function app.sitzung_beenden(p_token_hash bytea)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  wer uuid;
  m   uuid;
  ab  text;
begin
  -- Die Sitzung weiss, wie sie entstanden ist. Deshalb muss der Anbieter beim
  -- Abmelden nicht mitgegeben werden -- und kann auch nicht falsch angegeben
  -- werden.
  update sitzung s
     set beendet_am = now(), beendet_grund = 'abmeldung'
    from benutzer b
   where s.token_hash = p_token_hash
     and s.beendet_am is null
     and b.id = s.benutzer_id
  returning s.benutzer_id, b.mandant_id, s.anbieter into wer, m, ab;

  if wer is null then
    return false;
  end if;

  insert into anmelde_ereignis (mandant_id, benutzer_id, ergebnis, anbieter)
  values (m, wer, 'abmeldung', ab);
  return true;
end;
$$;


-- Beendet alle Sitzungen eines Benutzers. Fuer die Sperrung und fuer den
-- Fall, dass jemand sein Geraet verloren hat.
create or replace function app.sitzungen_widerrufen(p_benutzer_id uuid)
returns integer
language sql
security definer
set search_path = public, app
as $$
  with beendet as (
    update sitzung set beendet_am = now(), beendet_grund = 'widerruf'
     where benutzer_id = p_benutzer_id and beendet_am is null
     returning 1
  )
  select count(*)::integer from beendet;
$$;


create or replace function app.anmeldung_protokollieren(
  p_ergebnis text,
  p_anbieter text,
  p_hinweis  text default null
)
returns void
language sql
security definer
set search_path = public, app
as $$
  insert into anmelde_ereignis (ergebnis, anbieter, hinweis)
  values (p_ergebnis, p_anbieter, p_hinweis);
$$;


-- ---------------------------------------------------------------------------
-- Teil 5: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table sitzung          enable row level security;
alter table anmelde_ereignis enable row level security;

-- Die eigenen Sitzungen sieht man, fremde nicht -- auch nicht die von
-- Kollegen desselben Mandanten. Eine Sitzungsliste ist eine Sicherheits-,
-- keine Verwaltungsfunktion.
create policy sitzung_eigene on sitzung for select
  using (benutzer_id = app.mein_benutzer());

create policy anmelde_ereignis_eigene on anmelde_ereignis for select
  using (benutzer_id = app.mein_benutzer());

-- Kein insert/update/delete fuer dms_app: Sitzungen entstehen und enden
-- ausschliesslich ueber die Funktionen oben. Das ist der Grund, warum diese
-- Tabelle nicht wie die uebrigen eine `for all`-Policy bekommt.
grant select on sitzung, anmelde_ereignis to dms_app;
grant execute on function app.sitzung_aufloesen(bytea, integer) to dms_app;
grant execute on function app.identitaet_aufloesen(text, text, text) to dms_app;
grant execute on function app.sitzung_anlegen(uuid, bytea, text, integer) to dms_app;
grant execute on function app.sitzung_beenden(bytea) to dms_app;
grant execute on function app.sitzungen_widerrufen(uuid) to dms_app;
grant execute on function app.anmeldung_protokollieren(text, text, text) to dms_app;
