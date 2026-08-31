-- Postausgang: Vorlagen und Ausgangsbuch
--
-- Konzept 24.2: "Vorlagen fuer Ausgangspost -- Reklamation,
-- Abtretungserklaerung, Rueckfrage, Benachrichtigung. Die Systemaktionen sind
-- vorgesehen, die Vorlagenverwaltung mit Platzhaltern fehlt."
--
-- Sie fehlte an fuenf Stellen gleichzeitig: scan2bank (Konzept 12), der Link
-- zur Belegeinsicht (17), die Abtretungserklaerung und die Technikmeldung
-- (10), und der Mailweg im Posteingang. Jede fuer sich haette eine
-- Sonderloesung bekommen; zusammen bekommen sie eine.
--
-- **Das Ausgangsbuch ist der eigentliche Gewinn.** Ohne es waere Senden eine
-- Handlung ohne Spur: Niemand koennte sagen, ob die Bank den Zahlungsauftrag
-- bekommen hat. Mit ihm ist ein gescheiterter Versand sichtbar und
-- wiederholbar, statt still verloren.
--
-- Damit aendert sich eine frühere Entscheidung. Bei der Zahlungsuebergabe
-- stand: lieber gar nicht uebergeben als eine Zahlung als uebergeben zu
-- vermerken, die nie jemanden erreicht. Die Begruendung war, dass der Beleg
-- sonst aus allen Listen verschwindet. Mit einem Ausgangsbuch verschwindet er
-- nicht -- der fehlgeschlagene Eintrag steht sichtbar da. Der Versand darf
-- deshalb aus dem Stempel heraus und in die Warteschlange: Ein haengender
-- Mailserver soll keinen Stempel blockieren.


-- ---------------------------------------------------------------------------
-- Teil 1: Vorlagen
-- ---------------------------------------------------------------------------

create table vorlage (
  id           uuid primary key default gen_random_uuid(),
  mandant_id   uuid not null references mandant(id),
  -- Der Schluessel ist die Anknuepfung aus dem Code: `zahlungsauftrag`,
  -- `einsicht_link`, `abtretung`, `technikmeldung`. Der Name ist fuer
  -- Menschen.
  schluessel   text not null,
  name         text not null,
  betreff      text not null,
  text         text not null,
  aktiv        boolean not null default true,
  geaendert_am timestamptz not null default now(),
  geaendert_von uuid references benutzer(id),
  unique (mandant_id, schluessel)
);

comment on table vorlage is
  'Betreff und Text der Ausgangspost, mit Platzhaltern. Stammdatum und kein '
  'Code: Wer die Formulierung aendert, aendert eine Zeile (Konzept 24.2).';

comment on column vorlage.text is
  'Platzhalter in doppelten geschweiften Klammern. Welche es gibt, bestimmt '
  'eine Weissliste im Code -- eine freie Vorlagensprache koennte den ganzen '
  'Beleg in eine Mail schreiben.';


-- ---------------------------------------------------------------------------
-- Teil 2: Das Ausgangsbuch
-- ---------------------------------------------------------------------------

create table ausgang (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  dokument_id   uuid references dokument(id) on delete set null,
  anlass        text not null,
  empfaenger    text not null,
  betreff       text not null,
  text          text not null,
  anhang_key    text,
  anhang_name   text,

  status        text not null default 'offen'
                check (status in ('offen','gesendet','fehlgeschlagen')),
  versuche      integer not null default 0,
  angelegt_am   timestamptz not null default now(),
  gesendet_am   timestamptz,
  fehler        text,

  check ((status = 'gesendet') = (gesendet_am is not null))
);

create index ausgang_offen_idx on ausgang (angelegt_am)
  where status in ('offen','fehlgeschlagen');
create index ausgang_dokument_idx on ausgang (dokument_id);

comment on table ausgang is
  'Was das Haus verlassen soll oder hat. Angelegt in derselben Transaktion '
  'wie der Anlass -- ein Zahlungsauftrag ohne Ausgangseintrag oder ein '
  'Eintrag ohne Zahlung gibt es damit nicht.';

comment on column ausgang.anlass is
  'Woher der Eintrag kommt: `zahlung`, `einsicht`, `abtretung`, '
  '`technikmeldung`. Freitext, damit ein neuer Anlass keinen Schemawechsel '
  'kostet.';

comment on column ausgang.text is
  'Der fertige Text, nicht die Vorlage. Wer spaeter fragt "was stand da '
  'eigentlich drin", bekommt eine Antwort -- auch wenn die Vorlage seither '
  'geaendert wurde.';


-- Legt einen Ausgang an. Als Funktion, damit sie aus einer laufenden
-- Transaktion heraus aufgerufen werden kann -- gemeinsam mit dem Anlass.
create or replace function app.ausgang_anlegen(
  p_dokument_id uuid,
  p_anlass      text,
  p_empfaenger  text,
  p_betreff     text,
  p_text        text,
  p_anhang_key  text default null,
  p_anhang_name text default null
)
returns uuid
language plpgsql
set search_path = public, app
as $$
declare
  neuer uuid;
  m     uuid;
begin
  if p_empfaenger is null or btrim(p_empfaenger) = '' then
    raise exception 'Ein Ausgang ohne Empfaenger waere kein Ausgang.';
  end if;

  select coalesce(
           (select d.mandant_id from dokument d where d.id = p_dokument_id),
           app.mein_mandant())
    into m;

  insert into ausgang (mandant_id, dokument_id, anlass, empfaenger, betreff,
                       text, anhang_key, anhang_name)
  values (m, p_dokument_id, p_anlass, btrim(p_empfaenger), p_betreff, p_text,
          p_anhang_key, p_anhang_name)
  returning id into neuer;

  return neuer;
end;
$$;


-- Haelt fest, wie es ausgegangen ist.
--
-- `security definer`, weil der Worker ohne Benutzerkontext arbeitet und die
-- RLS auf `ausgang` sonst nichts findet. Dieselbe Begruendung wie bei der
-- Sitzung -- und dieselbe Enge: Die Funktion aendert genau eine Zeile und
-- nur ihren Zustand.
create or replace function app.ausgang_vermerken(
  p_ausgang_id uuid,
  p_erfolg     boolean,
  p_fehler     text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  betroffen integer;
begin
  update ausgang
     set status = case when p_erfolg then 'gesendet' else 'fehlgeschlagen' end,
         gesendet_am = case when p_erfolg then now() else null end,
         versuche = versuche + 1,
         fehler = case when p_erfolg then null else p_fehler end
   where id = p_ausgang_id;

  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;


-- Was noch raus muss.
create or replace function app.ausgang_offen(p_grenze integer default 50)
returns table (
  ausgang_id  uuid,
  empfaenger  text,
  betreff     text,
  text        text,
  anhang_key  text,
  anhang_name text,
  versuche    integer
)
language sql
stable
security definer
set search_path = public, app
as $$
  select a.id, a.empfaenger, a.betreff, a.text, a.anhang_key, a.anhang_name,
         a.versuche
    from ausgang a
   where a.status = 'offen'
   order by a.angelegt_am
   limit p_grenze;
$$;

comment on function app.ausgang_offen(integer) is
  'Fuer den Worker, der ohne Benutzerkontext arbeitet -- deshalb security '
  'definer. Liefert bewusst nur `offen`: Ein fehlgeschlagener Versand wird '
  'nicht selbsttaetig wiederholt, sondern angesehen.';


-- ---------------------------------------------------------------------------
-- Teil 3: Vorlagen im Bestand
-- ---------------------------------------------------------------------------

-- Anlegen, nicht erfinden: Diese vier Anlaesse stehen im Konzept, und ohne
-- Vorlage koennte keiner von ihnen senden. Die Formulierungen sind ein
-- Anfang und ausdruecklich zum Aendern gedacht.
--
-- Als **Funktion mit Trigger** und nicht als einmaliges INSERT. Der erste
-- Entwurf schrieb `from mandant` -- und fand nichts: Migrationen laufen vor
-- dem Seed, es gab noch keinen Mandanten. Ein Test hat es aufgedeckt, und
-- der Fehler waere auch beim ersten echten Mandanten aufgetreten. Ein neuer
-- Mandant bekommt seine Vorlagen jetzt beim Anlegen.
create or replace function app.vorlagen_grundbestand(p_mandant_id uuid)
returns integer
language plpgsql
set search_path = public, app
as $$
declare
  angelegt integer;
begin
  insert into vorlage (mandant_id, schluessel, name, betreff, text)
  select p_mandant_id, v.schluessel, v.name, v.betreff, v.text
  from (values
    ('zahlungsauftrag', 'Zahlungsauftrag an die Bank',
     'Zahlungsauftrag {{rechnungsnummer}}',
     E'Sehr geehrte Damen und Herren,\n\nanbei ein Zahlungsauftrag zur Rechnung {{rechnungsnummer}} von {{kreditor}}.\n\nObjekt: {{objekt}}\nBetrag: {{betrag}}\nFaellig: {{faellig}}\n\nMit freundlichen Gruessen'),

    ('einsicht_link', 'Zugang zur Belegeinsicht',
     'Ihre Belegeinsicht zu Objekt {{objekt}}',
     E'Guten Tag {{empfaenger}},\n\nunter folgendem Link koennen Sie die Belege zu Objekt {{objekt}} einsehen:\n\n{{link}}\n\nDer Zugang gilt bis {{gueltig_bis}} und ist persoenlich.\n\nMit freundlichen Gruessen'),

    ('abtretung', 'Abtretungserklaerung an die ausfuehrende Firma',
     'Abtretungserklaerung zu {{rechnungsnummer}}',
     E'Sehr geehrte Damen und Herren,\n\nzur Rechnung {{rechnungsnummer}} ueber {{betrag}} tritt der Eigentuemer seinen Anspruch gegen die Versicherung an Sie ab.\n\nObjekt: {{objekt}}\n\nMit freundlichen Gruessen'),

    ('technikmeldung', 'Meldung an die Technik-Datenbank',
     'Erfassung {{objekt}}: {{rechnungsnummer}}',
     E'Automatische Meldung aus dem DMS.\n\nObjekt: {{objekt}}\nBeleg: {{rechnungsnummer}} von {{kreditor}}\nBetrag: {{betrag}}\n\nBitte in der Technik-Datenbank erfassen.')
  ) as v(schluessel, name, betreff, text)
  on conflict (mandant_id, schluessel) do nothing;

  get diagnostics angelegt = row_count;
  return angelegt;
end;
$$;

create or replace function app.vorlagen_beim_mandanten()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  perform app.vorlagen_grundbestand(new.id);
  return null;
end;
$$;

create trigger mandant_vorlagen
  after insert on mandant
  for each row execute function app.vorlagen_beim_mandanten();

comment on trigger mandant_vorlagen on mandant is
  'Ein neuer Mandant bekommt die Vorlagen des Grundbestands. Ohne sie koennte '
  'er keine Ausgangspost erzeugen, und der Fehler faellt erst beim ersten '
  'Zahlungsauftrag auf.';

-- Fuer Mandanten, die es zum Zeitpunkt dieser Migration schon gibt.
select app.vorlagen_grundbestand(m.id) from mandant m;


-- ---------------------------------------------------------------------------
-- Teil 4: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table vorlage enable row level security;
alter table ausgang enable row level security;

create policy vorlage_sicht on vorlage for all
  using (mandant_id = (select app.mein_mandant()))
  with check (mandant_id = (select app.mein_mandant()));

-- Das Ausgangsbuch folgt dem Mandanten, nicht dem Beleg: Ein Eintrag ohne
-- Dokumentbezug -- etwa ein Einsichtslink -- haette sonst niemanden, der ihn
-- sieht.
create policy ausgang_sicht on ausgang for select
  using (mandant_id = (select app.mein_mandant()));

-- Anlegen und Wiederholen laufen **unter** der RLS, nicht daran vorbei:
-- `app.ausgang_anlegen` ist bewusst kein `security definer`. Wer den Beleg
-- nicht sieht, legt zu ihm auch keine Post an.
create policy ausgang_anlegen on ausgang for insert
  with check (mandant_id = (select app.mein_mandant()));

-- Nur das Wiederholen eines gescheiterten Versands. Den Erfolg vermerkt der
-- Worker ueber `app.ausgang_vermerken` -- er arbeitet ohne Benutzerkontext
-- und ist deshalb security definer.
create policy ausgang_wiederholen on ausgang for update
  using (mandant_id = (select app.mein_mandant()) and status = 'fehlgeschlagen')
  with check (mandant_id = (select app.mein_mandant()));

grant select, insert, update on vorlage to dms_app;
grant select, insert, update on ausgang to dms_app;
grant execute on function app.ausgang_anlegen(uuid, text, text, text, text, text, text)
  to dms_app;
grant execute on function app.ausgang_vermerken(uuid, boolean, text) to dms_app;
grant execute on function app.ausgang_offen(integer) to dms_app;
grant execute on function app.vorlagen_grundbestand(uuid) to dms_app;
