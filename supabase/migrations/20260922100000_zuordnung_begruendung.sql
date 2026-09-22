-- ---------------------------------------------------------------------------
-- Warum ist dieser Beleg hier? -- die Begruendung wird aufgeschrieben
-- ---------------------------------------------------------------------------
--
-- Im abzuloesenden System muss man alle Magneten gleichzeitig lesen, um zu
-- wissen, warum ein Beleg in einem Ordner liegt (docs/analyse-amagno-
-- bestand.md, Abschnitt 1). Hier soll jeder Beleg den Satz selbst sagen:
-- "Objekt 42, weil Kundennummer 12345 dafuer gelernt ist. Kategorie
-- Betriebskosten, weil am Kreditor hinterlegt. Ablauf Rechnung Fassung 1,
-- weil die Kategorie ihn benennt. Bearbeiter Bernd, weil Rolle Buchhaltung."
--
-- Ablauf und Bearbeiter lassen sich jederzeit aus dem Bestand ableiten --
-- sie folgen Regeln, die noch gelten. Objekt und Kategorie nicht: Wie sie
-- zustande kamen, ist eine Tatsache des Augenblicks (welches Muster damals
-- griff, was am Kreditor damals stand). Wer sie spaeter nachrechnet, bekommt
-- womoeglich einen anderen Grund als den, der gewirkt hat. Deshalb werden
-- diese beiden **aufgeschrieben**, im Moment der Zuordnung.
--
-- Es sind Textspalten und keine Tabelle: Eine Zuordnung hat genau einen
-- Grund, und der aendert sich nur, wenn die Zuordnung sich aendert. Die
-- Historie der Aenderungen steht in korrektur_ereignis.

alter table dokument
  add column objekt_begruendung    text,
  add column kategorie_quelle      text check (kategorie_quelle in
                                     ('kreditor','muster','schluesselwort',
                                      'eingangsquelle','mensch')),
  add column kategorie_begruendung text;

comment on column dokument.objekt_begruendung is
  'Warum dieser Beleg diesem Objekt zugeordnet wurde -- im Moment der '
  'Zuordnung aufgeschrieben, weil sich der Grund spaeter nicht mehr sicher '
  'nachrechnen laesst.';
comment on column dokument.kategorie_quelle is
  'Woher die Kategorie kam: Standard am Kreditor, gelerntes Muster, '
  'Schluesselwort, Vorgabe der Eingangsquelle oder ein Mensch.';
comment on column dokument.kategorie_begruendung is
  'Der Satz dazu, fuer die Anzeige am Beleg.';

-- Die Zuordnungsfunktion nimmt die Begruendung mit -- optional, damit
-- bestehende Aufrufer unveraendert weiterlaufen.
--
-- Erst die alte Signatur entfernen, dann die neue anlegen: Zwei Fassungen
-- nebeneinander -- (uuid, uuid) und (uuid, uuid, text default null) -- machen
-- jeden zweistelligen Aufruf mehrdeutig ("function is not unique"), und der
-- steht in der Aufbereitung und in der Korrektur.
drop function if exists app.dokument_zuordnen(uuid, uuid);

create or replace function app.dokument_zuordnen(
  p_dokument_id uuid,
  p_objekt_id   uuid,
  p_begruendung text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  gehoert_mir boolean;
begin
  select d.mandant_id = app.mein_mandant()
         and o.mandant_id = app.mein_mandant()
         and d.objekt_id is null
    into gehoert_mir
    from dokument d, objekt o
   where d.id = p_dokument_id and o.id = p_objekt_id;

  if gehoert_mir is not true then
    return false;
  end if;

  update dokument
     set objekt_id = p_objekt_id,
         objekt_begruendung = coalesce(p_begruendung, objekt_begruendung)
   where id = p_dokument_id;
  return true;
end;
$$;

comment on function app.dokument_zuordnen(uuid, uuid, text) is
  'Ordnet einen noch nicht zugeordneten Beleg einem Objekt des eigenen '
  'Mandanten zu -- auch einem, fuer das der Zuordnende nicht zustaendig ist. '
  'Danach sieht er den Beleg womoeglich nicht mehr, und das ist richtig so. '
  'Die Begruendung wird am Beleg festgehalten. Eine bereits bestehende '
  'Zuordnung aendert die Funktion nicht; das waere eine Umgruppierung und '
  'braucht Begruendung und Protokoll (Konzept 4).';

grant execute on function app.dokument_zuordnen(uuid, uuid, text) to dms_app;
