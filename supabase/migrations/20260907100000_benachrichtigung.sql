-- ===========================================================================
-- Benachrichtigungen (Konzept 24, Punkt 9)
-- ===========================================================================
--
-- Das Konzept stellt die Frage offen: "Mail oder nur Zaehler in der
-- Oberflaeche". Die Antwort hier ist **beides, aber verschieden dosiert** --
-- und die Begruendung gehoert dazu, weil die naheliegende Loesung die
-- schlechtere ist.
--
-- WARUM KEINE MAIL JE AUFGABE
--
-- Eine Mail pro Aufgabe ist die erste Idee und haelt zwei Wochen. Danach
-- filtert sie jeder in einen Ordner, den niemand oeffnet -- und dann ist
-- auch die eine Mail verloren, die wichtig war. Ein Postfach mit vierzig
-- ungelesenen Systemmails ist schlechter als gar keine Benachrichtigung,
-- weil es Sicherheit vortaeuscht.
--
-- Deshalb: **eine Sammelmail am Tag**, und nur, wenn es etwas zu sagen gibt.
-- Keine Mail ueber null Aufgaben.
--
-- WARUM IN DER MAIL KEIN BELEG STEHT
--
-- Naheliegend waere, die faelligen Belege aufzuzaehlen -- Kreditor, Betrag,
-- Frist. Genau das steht hier nicht drin, und das ist die wichtigere
-- Entscheidung dieser Migration.
--
-- Ein Postfach ist schlechter geschuetzt als dieses System: keine RLS, keine
-- Sitzung, kein Protokoll, und es wird auf Geraeten gelesen, ueber die
-- niemand Auskunft geben kann. Eine Mail mit Belegdaten waere eine zweite,
-- schwaechere Kopie des Bestands -- und sie entstuende taeglich neu.
--
-- Die Mail nennt deshalb nur **Zahlen und einen Link**. Sie ist ein Anstoss,
-- kein Bericht; gearbeitet wird im System, wo die Berechtigung gilt.
--
-- DER ZAEHLER IST DIE HAELFTE, DIE STAENDIG WIRKT
--
-- Die Mail kommt einmal am Tag. Wer im System arbeitet, sieht die Zahl
-- dauernd -- das ist die wirksamere der beiden Haelften und kostet nichts.


-- ---------------------------------------------------------------------------
-- Teil 1: Was jemand wuenscht
-- ---------------------------------------------------------------------------
--
-- Eine eigene Tabelle und keine Spalte an `benutzer`: Der Benutzer ist ein
-- Stammdatum und wird von der Benutzerverwaltung gepflegt; ob jemand eine
-- Mail moechte, ist seine eigene Sache und braucht kein Verwaltungsrecht.
--
-- Ohne Zeile gilt **an**. Eine Benachrichtigung, die man erst einschalten
-- muss, schaltet niemand ein -- und dann faellt eine Frist auf, wenn sie
-- vorbei ist.

create table benachrichtigung (
  benutzer_id     uuid primary key references benutzer(id) on delete cascade,
  taeglich        boolean not null default true,

  -- Wann die Sammelmail entsteht. Frueh am Morgen, damit sie vor der Arbeit
  -- liegt und nicht mitten hinein.
  stunde          smallint not null default 7 check (stunde between 0 and 23),

  -- Verhindert die zweite Mail am selben Tag. Der Durchgang laeuft
  -- stuendlich; ohne diesen Vermerk bekaeme jeder ab seiner Stunde jede
  -- Stunde eine.
  zuletzt_gesendet date,

  geaendert_am    timestamptz not null default now()
);

comment on table benachrichtigung is
  'Ob und wann jemand die taegliche Sammelmail moechte. Ohne Zeile gilt an: '
  'Eine Benachrichtigung, die man erst einschalten muss, schaltet niemand '
  'ein -- und dann faellt eine Frist auf, wenn sie vorbei ist.';

comment on column benachrichtigung.zuletzt_gesendet is
  'Verhindert die zweite Mail am selben Tag. Der Durchgang laeuft stuendlich; '
  'ohne diesen Vermerk bekaeme jeder ab seiner Stunde jede Stunde eine.';

alter table benachrichtigung enable row level security;

-- Jeder sieht und aendert nur den eigenen Wunsch. Kein Verwaltungsrecht --
-- wann jemand eine Mail moechte, geht niemanden sonst etwas an.
create policy benachrichtigung_eigene on benachrichtigung for all
  using (benutzer_id = (select app.mein_benutzer()))
  with check (benutzer_id = (select app.mein_benutzer()));

grant select, insert, update on benachrichtigung to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 2: Der Zaehler fuer die Oberflaeche
-- ---------------------------------------------------------------------------
--
-- Laeuft unter den Rechten des Fragenden -- die RLS auf `aufgabe` ist der
-- Filter, wie ueberall. Kein `security definer`: Ein Zaehler, der mehr
-- zaehlt als die Liste darunter zeigt, ist schlimmer als keiner.
create or replace function app.aufgaben_zaehler()
returns table (offen bigint, ueberfaellig bigint)
language sql
stable
set search_path = public, app
as $$
  select count(*) filter (where a.status in ('offen','in_arbeit')),
         count(*) filter (where a.status in ('offen','in_arbeit')
                            and a.faellig_am < now())
    from aufgabe a
   where a.zugewiesen_benutzer = app.mein_benutzer();
$$;

comment on function app.aufgaben_zaehler() is
  'Offene und ueberfaellige Aufgaben des Angemeldeten -- fuer die Zahl neben '
  'dem Postfach. Ohne security definer: Ein Zaehler, der mehr zaehlt als die '
  'Liste darunter zeigt, ist schlimmer als keiner.';

grant execute on function app.aufgaben_zaehler() to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 3: Wer heute eine Sammelmail bekommt
-- ---------------------------------------------------------------------------
--
-- `security definer`, weil der Worker keinen anmeldenden Benutzer hat --
-- dieselbe Auflage wie bei den Eingangsquellen. Die Funktion gibt **keine
-- Belegdaten** heraus, nur Zahlen und die Adresse dessen, der sie ohnehin
-- sehen darf.
--
-- Ueber alle Mandanten: Der Worker ist einer, und eine Sammelmail kennt
-- keine Mandantengrenze. Die Zahlen sind je Benutzer und damit von selbst
-- richtig zugeordnet -- ein Benutzer zaehlt nur seine eigenen Aufgaben.
create or replace function app.benachrichtigung_faellig(
  p_stunde  integer default extract(hour from now())::integer,
  p_stichtag date default current_date
)
returns table (
  benutzer_id  uuid,
  name         text,
  email        text,
  anzahl       bigint,
  ueberfaellig bigint
)
language sql
stable
security definer
set search_path = public, app
as $$
  select b.id, b.name, b.email,
         count(a.id) filter (where a.status in ('offen','in_arbeit')),
         count(a.id) filter (where a.status in ('offen','in_arbeit')
                               and a.faellig_am < now())
    from benutzer b
    left join benachrichtigung n on n.benutzer_id = b.id
    join aufgabe a on a.zugewiesen_benutzer = b.id
   where b.aktiv
     -- Ohne Zeile gilt an, mit Zeile ihr Wert.
     and coalesce(n.taeglich, true)
     and coalesce(n.stunde, 7) = p_stunde
     -- Nicht zweimal am selben Tag.
     and (n.zuletzt_gesendet is null or n.zuletzt_gesendet < p_stichtag)
   group by b.id, b.name, b.email
  -- Keine Mail ueber null Aufgaben. Eine Benachrichtigung, die auch dann
  -- kommt, wenn nichts zu tun ist, wird zur Gewohnheit und danach zur
  -- Nachricht, die man wegklickt.
  having count(a.id) filter (where a.status in ('offen','in_arbeit')) > 0;
$$;

comment on function app.benachrichtigung_faellig(integer, date) is
  'Wer jetzt eine Sammelmail bekommt -- mit Zahlen, ohne Belegdaten. Keine '
  'Mail ueber null Aufgaben: Eine Benachrichtigung, die auch dann kommt, '
  'wenn nichts zu tun ist, wird zur Gewohnheit und danach zur Nachricht, '
  'die man wegklickt.';


create or replace function app.benachrichtigung_vermerken(
  p_benutzer uuid,
  p_stichtag date default current_date
)
returns void
language sql
security definer
set search_path = public, app
as $$
  insert into benachrichtigung (benutzer_id, zuletzt_gesendet)
  values (p_benutzer, p_stichtag)
  on conflict (benutzer_id)
  do update set zuletzt_gesendet = excluded.zuletzt_gesendet;
$$;

comment on function app.benachrichtigung_vermerken(uuid, date) is
  'Haelt fest, dass die Sammelmail heute im Ausgangsbuch liegt -- aufzurufen '
  'nach dem Eintragen, in derselben Transaktion. Andersherum entstuende bei '
  'einem Abbruch ein Vermerk ohne Mail, und der Tag waere still verloren.';

grant execute on function app.benachrichtigung_faellig(integer, date) to dms_app;
grant execute on function app.benachrichtigung_vermerken(uuid, date) to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 4: Die Vorlage
-- ---------------------------------------------------------------------------
--
-- In den **Grundbestand**, nicht als einmaliges Insert.
--
-- Mein erster Entwurf schrieb `insert into vorlage ... from mandant` -- und
-- legte nichts an: Migrationen laufen vor dem Seed, und einen Mandanten gibt
-- es zu dem Zeitpunkt nicht. Genau dieser Fehler steht seit
-- 20260831250000 im Kommentar ueber `app.vorlagen_grundbestand`, und ich bin
-- trotzdem hineingelaufen. Die Vorlage gehoert dorthin, wo die uebrigen
-- stehen.
--
-- Der Grundbestand wird neu geschrieben (die bestehenden Eintraege Wort fuer
-- Wort, `on conflict do nothing` laesst sie unberuehrt) und fuer bereits
-- angelegte Mandanten nachgezogen -- lokal trifft das nichts, im Betrieb
-- jeden bestehenden Mandanten.
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
     E'Automatische Meldung aus dem DMS.\n\nObjekt: {{objekt}}\nBeleg: {{rechnungsnummer}} von {{kreditor}}\nBetrag: {{betrag}}\n\nBitte in der Technik-Datenbank erfassen.'),

    -- Neu: die taegliche Sammelmail. Sie nennt nur Zahlen und einen Link --
    -- ein Postfach ist schlechter geschuetzt als dieses System.
    ('tagesuebersicht', 'Taegliche Uebersicht der offenen Aufgaben',
     'Ihre offenen Belege im DMS',
     E'Guten Tag {{empfaenger}},\n\nin Ihrem Postfach liegen {{anzahl}} offene Aufgaben, davon {{ueberfaellig}} ueber der Frist.\n\n{{link}}\n\nDiese Nachricht nennt bewusst keine Belegdaten -- die stehen im System, wo Ihre Berechtigung gilt.\n\nMit freundlichen Gruessen')
  ) as v(schluessel, name, betreff, text)
  on conflict (mandant_id, schluessel) do nothing;

  get diagnostics angelegt = row_count;
  return angelegt;
end;
$$;

-- Fuer Mandanten, die es schon gibt.
do $$
declare
  m uuid;
begin
  for m in (select id from mandant) loop
    perform app.vorlagen_grundbestand(m);
  end loop;
end
$$;
