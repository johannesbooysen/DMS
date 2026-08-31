-- Fluechtige Ausgaenge: der Text verschwindet nach dem Senden
--
-- Anlass ist der Link zur Belegeinsicht (Konzept 17). Die Einsicht speichert
-- vom Token nur den Hash -- wer die Seite verlaesst, ohne ihn zu kopieren,
-- legt eine neue Gewaehrung an. Der Grund: Ein Token, der sich nachtraeglich
-- abrufen laesst, ist ein Token, den auch ein Datenbankauszug hergibt.
--
-- Genau das wuerde ein Ausgangseintrag aber tun. `ausgang.text` haelt den
-- fertigen Text fest, damit spaeter beantwortbar ist, was drinstand -- und
-- drin steht dann ein gueltiger Zugangslink, im Klartext, so lange die
-- Gewaehrung laeuft.
--
-- Deshalb dieses Kennzeichen. Bei `fluechtig` wird der Text nach
-- erfolgreichem Versand durch einen Vermerk ersetzt. Das Fenster ist die
-- Zeit zwischen Anlegen und Versand -- eine halbe Minute im Regelfall.
--
-- Die Alternative waere, den Link gar nicht zu versenden und ihn wie bisher
-- von Hand weiterzureichen. Sie ist schlechter: Dann liegt der Token im
-- Postausgang eines Mailprogramms, dauerhaft, ohne Widerruf und ohne Spur.
--
-- Was verloren geht: die Frage "was stand in dieser Mail". Fuer die Einsicht
-- ist sie beantwortbar geblieben -- `einsicht_gewaehrung` haelt Empfaenger,
-- Umfang, Gueltigkeit und Widerruf fest, und `zugriff_protokoll` haelt fest,
-- was damit geschah. Verloren geht nur der Token selbst, und der soll weg.

alter table ausgang
  add column fluechtig boolean not null default false;

comment on column ausgang.fluechtig is
  'Der Text enthaelt ein Geheimnis (heute: den Einsichts-Token) und wird '
  'nach erfolgreichem Versand ersetzt. Nur fuer Inhalte, die nach dem Senden '
  'niemand mehr lesen koennen soll.';


-- Wie oben, plus `p_fluechtig`.
create or replace function app.ausgang_anlegen(
  p_dokument_id uuid,
  p_anlass      text,
  p_empfaenger  text,
  p_betreff     text,
  p_text        text,
  p_anhang_key  text default null,
  p_anhang_name text default null,
  p_fluechtig   boolean default false
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
                       text, anhang_key, anhang_name, fluechtig)
  values (m, p_dokument_id, p_anlass, btrim(p_empfaenger), p_betreff, p_text,
          p_anhang_key, p_anhang_name, coalesce(p_fluechtig, false))
  returning id into neuer;

  return neuer;
end;
$$;


-- Wie oben, loescht bei `fluechtig` zusaetzlich den Text.
--
-- Nur bei Erfolg. Ein fehlgeschlagener Versand behaelt seinen Text, sonst
-- waere die Wiederholung sinnlos -- und der Eintrag steht ohnehin sichtbar
-- im Ausgangsbuch, wo er nachgesehen und widerrufen werden kann.
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
         fehler = case when p_erfolg then null else p_fehler end,
         text = case
                  when p_erfolg and fluechtig
                  then '[Inhalt nach dem Versand entfernt: enthielt einen '
                       'persoenlichen Zugangslink.]'
                  else text
                end
   where id = p_ausgang_id;

  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;


-- Wie oben, plus `fluechtig` -- der Worker braucht es nicht, aber der
-- Rueckgabetyp einer `returns table`-Funktion laesst sich nicht erweitern,
-- ohne sie neu anzulegen, und getrennte Signaturen waeren verwirrender.
drop function if exists app.ausgang_offen(integer);

create or replace function app.ausgang_offen(p_grenze integer default 50)
returns table (
  ausgang_id  uuid,
  empfaenger  text,
  betreff     text,
  text        text,
  anhang_key  text,
  anhang_name text,
  versuche    integer,
  fluechtig   boolean
)
language sql
stable
security definer
set search_path = public, app
as $$
  select a.id, a.empfaenger, a.betreff, a.text, a.anhang_key, a.anhang_name,
         a.versuche, a.fluechtig
    from ausgang a
   where a.status = 'offen'
   order by a.angelegt_am
   limit p_grenze;
$$;

comment on function app.ausgang_offen(integer) is
  'Fuer den Worker, der ohne Benutzerkontext arbeitet -- deshalb security '
  'definer. Liefert bewusst nur `offen`: Ein fehlgeschlagener Versand wird '
  'nicht selbsttaetig wiederholt, sondern angesehen.';


-- Zum Wiederholen: Ein fluechtiger Eintrag, dessen Text entfernt wurde,
-- duerfte nicht noch einmal hinausgehen -- er traege nur noch den Vermerk.
-- Der Fall kann nicht eintreten, weil `postWiederholen` ausschliesslich
-- `fehlgeschlagen` zuruecksetzt und der Text nur bei **Erfolg** entfernt
-- wird. Eine Bedingung im Schema koennte das nicht besser: Der Vermerk ist
-- ein gueltiger Text wie jeder andere, von aussen nicht zu unterscheiden.
-- Wer die Bedingung sucht, findet sie im `where` von `postWiederholen`.
