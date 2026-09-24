-- Die Zahlungssperre kennt die Belegart: Eine Mahnung wird nie separat
-- bezahlt (Konzept 14). Bis hierher war das ein Hinweistext am Beleg; die
-- Sperre pruefte Freigaben, Pflichtstufen, Summenzwang, Befunde, Zahlungsweg
-- und Bankverbindung -- die Belegart nicht. Eine Mahnung mit vollstaendigen
-- Stempeln liess sich als zweite Zahlung uebergeben.
--
-- Die Funktion wird als Ganzes neu geschrieben (der Rumpf ist der aus
-- 20260831190000), mit der Belegart als nullter Pruefung: Sie steht vor
-- allem anderen, weil sie das Hindernis ist, das kein Stempel behebt.

create or replace function app.zahlung_moeglich(p_dokument_id uuid)
returns table (moeglich boolean, hindernis text)
language plpgsql
stable
set search_path = public, app
as $$
declare
  lauf         record;
  offene       integer;
  ungueltige   integer;
  hart         text;
  weg          record;
  bank         integer;
begin
  select l.id, l.status, d.status as dokument_status, d.belegart
    into lauf
    from dokument_lauf l
    join dokument d on d.id = l.dokument_id
   where l.dokument_id = p_dokument_id;

  if not found then
    return query select false, 'Zu diesem Beleg laeuft kein Ablauf.'::text;
    return;
  end if;

  if lauf.dokument_status = 'abgelehnt' then
    return query select false, 'Der Beleg ist abgelehnt.'::text;
    return;
  end if;

  -- 0. Die Belegart. Eine Mahnung wird nie separat bezahlt -- bezahlt wird
  --    die Rechnung, auf die sie sich bezieht (Konzept 14). Bis Migration
  --    20260927100000 stand das als Hinweistext am Beleg; wer den Hinweis
  --    uebersah, konnte die Mahnung als zweite Zahlung uebergeben.
  if lauf.belegart = 'mahnung' then
    return query select false,
      'Eine Mahnung wird nie separat bezahlt -- bezahlt wird die Rechnung, '
      'auf die sie sich bezieht.'::text;
    return;
  end if;

  -- 1. Gueltige Stempel. Zuerst, weil eine nachtraegliche Aenderung alle
  --    weiteren Pruefungen bedeutungslos macht: Was hier freigegeben wurde,
  --    war eine andere Rechnung.
  select count(*) into ungueltige
    from app.gueltige_freigaben(lauf.id) g where not g.gueltig;

  if ungueltige > 0 then
    return query select false,
      'Die freigaberelevanten Daten haben sich nach der Freigabe geaendert. '
      'Die betroffenen Stufen muessen erneut durchlaufen werden.'::text;
    return;
  end if;

  -- 2. Jede Pflichtstufe ist durch. Die Zahlungsstufe selbst zaehlt nicht --
  --    sie ist ja gerade die, an der gefragt wird.
  select count(*) into offene
    from aufgabe a
    join prozessstufe s on s.id = a.stufe_id
   where a.lauf_id = lauf.id
     and s.pflicht
     and s.stufentyp <> 'zahlung'
     and a.status not in ('erledigt','entfallen');

  if offene > 0 then
    return query select false,
      'Es sind noch Pflichtstufen offen.'::text;
    return;
  end if;

  -- 3. Summenzwang. Steht auch an der Kontierungsstufe, aber ein Beleg kann
  --    die Stufe passiert haben und danach eine Zeile verloren haben.
  if not coalesce(app.kontierung_summe_stimmt(p_dokument_id), false) then
    return query select false,
      'Die Kontierung ergibt nicht den Rechnungsbetrag.'::text;
    return;
  end if;

  -- 4. Harte Plausibilitaetsbefunde. IBAN passt nicht zum Kreditor und
  --    Dublette stoppen die Bearbeitung, sie faerben nicht nur (Konzept 14).
  select b.hinweis into hart
    from plausibilitaet_befund b
   where b.dokument_id = p_dokument_id and b.schwere = 'hart'
   order by b.erkannt_am
   limit 1;

  if hart is not null then
    return query select false, hart;
    return;
  end if;

  -- 5. Bankdaten, wenn der Weg sie verlangt. Die Pruefung laeuft VOR der
  --    Wegewahl: unvollstaendige Daten fuehren zur Sperre, nicht zu einer
  --    fehlgeschlagenen Uebergabe (Konzept 12).
  select z.* into weg
    from dokument d
    join objekt o on o.id = d.objekt_id
    join zahlungsweg z on z.id = o.zahlungsweg_id
   where d.id = p_dokument_id;

  if not found then
    return query select false,
      'Am Objekt ist kein Zahlungsweg hinterlegt.'::text;
    return;
  end if;

  if not weg.aktiv then
    return query select false,
      ('Der Zahlungsweg "' || weg.name || '" ist nicht aktiv.')::text;
    return;
  end if;

  if weg.bankdaten_pflicht then
    select count(*) into bank
      from rechnung_fakten f
      join kreditor_bankverbindung kb on kb.kreditor_id = f.kreditor_id
     where f.dokument_id = p_dokument_id and kb.status = 'verifiziert';

    if bank = 0 then
      return query select false,
        'Es gibt keine verifizierte Bankverbindung zum Kreditor.'::text;
      return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;
