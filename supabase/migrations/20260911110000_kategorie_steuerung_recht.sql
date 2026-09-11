-- ---------------------------------------------------------------------------
-- Wer die Kategorie auf einen Ablauf zeigen laesst, aendert den Ablauf
-- ---------------------------------------------------------------------------
--
-- Seit der Kategorieautomatik liest die Engine `ordnungsgruppe.prozess-
-- definition_id`. Damit ist diese eine Spalte **Ablaufsteuerung** -- sie
-- steht nur zufaellig auf einer Stammdatentabelle.
--
-- Und `ordnungsgruppe` steht unter `app.darf_stammdaten()`, also unter dem
-- Recht `stammdaten_pflegen`. Nachgestellt: Wer Kreditoren und Konten pflegen
-- darf, konnte die Kategorie "Betriebskosten" auf einen Ablauf **ohne
-- Freigabestufe** zeigen lassen. Danach laufen alle Betriebskostenrechnungen
-- an der Geschaeftsleitung vorbei -- ohne dass jemand ein Recht bekommen
-- haette, das er vorher nicht hatte, und ohne dass irgendetwas fehlschlaegt.
--
-- Das ist dieselbe Klasse wie die beiden Luecken davor (20260903100000 bei
-- den Stammdaten, 20260909100000 bei den Konfigurationstabellen): eine
-- Schreibpolicy, die ueber die Tabelle entscheidet statt ueber die Frage.
-- Die Frage lautet hier nicht "darf er Stammdaten pflegen", sondern "darf er
-- bestimmen, welcher Ablauf gilt".
--
-- **Warum ein Trigger und keine zweite Policy.** Eine Policy entscheidet je
-- Zeile, nicht je Spalte -- sie koennte nur das Schreiben der ganzen
-- Kategorie verbieten. Dann duerfte niemand mehr eine Farbe aendern, ohne
-- den Ablauf bestimmen zu duerfen. Getrennt werden soll aber genau die eine
-- Spalte.
--
-- Geprueft wird die **Aenderung**, nicht der Wert: Wer eine Kategorie
-- umbenennt, deren Ablauf unveraendert bleibt, braucht das Recht nicht.

create or replace function app.kategorie_ablauf_recht()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.prozessdefinition_id is not null and not app.darf_prozess() then
      raise exception
        'Welcher Ablauf fuer eine Kategorie gilt, bestimmt nur, wer Ablaeufe '
        'konfigurieren darf.';
    end if;
  elsif new.prozessdefinition_id is distinct from old.prozessdefinition_id
        and not app.darf_prozess() then
    raise exception
      'Welcher Ablauf fuer eine Kategorie gilt, bestimmt nur, wer Ablaeufe '
      'konfigurieren darf.';
  end if;
  return new;
end;
$$;

comment on function app.kategorie_ablauf_recht() is
  'Trennt die Ablaufsteuerung vom Rest der Kategorie: prozessdefinition_id '
  'verlangt prozess_konfigurieren, alle uebrigen Spalten weiterhin nur '
  'stammdaten_pflegen. Eine Policy koennte das nicht -- sie entscheidet je '
  'Zeile, nicht je Spalte.';

create trigger ordnungsgruppe_ablauf_recht
  before insert or update on ordnungsgruppe
  for each row execute function app.kategorie_ablauf_recht();
