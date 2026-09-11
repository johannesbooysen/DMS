-- ---------------------------------------------------------------------------
-- Die Kategorie ist der Schluessel -- sie fehlte als einziges Glied
-- ---------------------------------------------------------------------------
--
-- Beim Vergleich mit dem abzuloesenden System (docs/analyse-amagno-bestand.md)
-- kam heraus, dass fast alles fuer die automatische Zuordnung schon steht:
--
--   ordnungsgruppe.spezialgebiet_id     -> ueber spezialgebiet_zustaendigkeit
--                                          faellt der Mitarbeiter an
--   ordnungsgruppe.prozessdefinition_id -> die Kategorie benennt ihren Ablauf
--   ordnungsgruppe.konto_vorschlag_id   -> das Konto
--   kontierungs_muster                  -> Konto je Kreditor/Objekt/Position
--
-- Alle vier haengen an der **Ordnungsgruppe**. Und genau die setzte niemand:
-- `dokument.ordnungsgruppe_id` blieb leer, weil es keinen Weg gab, sie zu
-- bestimmen. Ein Schluessel, der in kein Schloss gesteckt wird.
--
-- Diese Migration liefert die zwei Stammdaten, aus denen sich die Kategorie
-- herleiten laesst, und den Trigger, der sie weiterwirken laesst.

-- ---------------------------------------------------------------------------
-- 1. Der Kreditor kennt seine uebliche Kategorie
-- ---------------------------------------------------------------------------
--
-- Das ist die bewusste Angabe eines Menschen -- "Stadtwerke buchen wir auf
-- Betriebskosten" -- und schlaegt deshalb jede Ableitung. Sie steht am
-- Kreditor und nicht in einer Regeltabelle, weil sie genau dort gepflegt
-- wird, wo man ohnehin nachsieht: im Stammdatensatz des Lieferanten.
--
-- Bewusst **Vorschlag und nicht Zwang**: Ein Versorger schickt auch einmal
-- eine Reparaturrechnung. Die Kategorie ist danach aenderbar wie jede andere.

alter table kreditor
  add column standard_ordnungsgruppe_id uuid references ordnungsgruppe(id);

comment on column kreditor.standard_ordnungsgruppe_id is
  'Uebliche Kategorie dieses Lieferanten. Vorschlag, kein Zwang -- die '
  'Zuordnung am Beleg bleibt aenderbar. Ein Fremdschluessel kann die '
  'Mandantengleichheit nicht erzwingen; die Ableitung prueft sie deshalb '
  'ausdruecklich (siehe src/lernen/kategorie.ts).';

-- ---------------------------------------------------------------------------
-- 2. Die Kategorie kennt ihre Schluesselworte
-- ---------------------------------------------------------------------------
--
-- Der letzte Ausweg, wenn der Lieferant unbekannt ist und nichts gelernt
-- wurde. Bewusst getrennt von `ki_beschreibung`: Das ist Fliesstext fuer das
-- Sprachmodell, hier stehen Worte fuer einen Textvergleich. Beides in ein
-- Feld zu legen hiesse, dass eine Aenderung am Prompt die Zuordnung
-- verschiebt, ohne dass jemand das beabsichtigt haette.
--
-- Ein Treffer ergibt nie besser als **orange** -- dieselbe Regel wie bei der
-- Objektzuordnung ueber Aehnlichkeit (Konzept 15). Ein Wort im Text ist ein
-- Hinweis, keine Tatsache.

alter table ordnungsgruppe
  add column schluesselwoerter text[] not null default '{}';

comment on column ordnungsgruppe.schluesselwoerter is
  'Worte, die im Belegtext auf diese Kategorie hindeuten. Treffer ergeben '
  'nie besser als orange -- ein Wort ist ein Hinweis, keine Tatsache.';

-- ---------------------------------------------------------------------------
-- 3. Aus der Kategorie faellt das Spezialgebiet -- und damit der Mitarbeiter
-- ---------------------------------------------------------------------------
--
-- `prozessstufe.zustaendigkeit_typ = 'spezialgebiet'` loest ueber
-- `spezialgebiet_zustaendigkeit` auf, wer zustaendig ist -- wahlweise je
-- Objekt. Damit ist "Objekt + Kategorie -> Mitarbeiter" bereits gebaut; es
-- fehlte nur, dass `dokument.spezialgebiet_id` jemals gesetzt wurde.
--
-- **Warum ein Trigger und nicht die Anwendung.** Der Wert ist abgeleitet, die
-- Regel ist eine einzige, und es gibt mehr als eine Stelle, die eine
-- Kategorie setzt (Aufbereitung, Erfassungsmaske, Korrektur, Stapeluebernahme).
-- Vier Aufrufer sind vier Gelegenheiten, den Nachzug zu vergessen -- und die
-- Folge waere ein Beleg, der bei niemandem im Postfach auftaucht. Genau
-- dieser Fehler steht im abzuloesenden System als "Single Point of Failure"
-- im roten Kasten.
--
-- Nur wenn noch nichts gesetzt ist: Wer das Spezialgebiet von Hand gewaehlt
-- hat, wusste mehr als die Ableitung.

create or replace function app.dokument_spezialgebiet_ableiten()
returns trigger
language plpgsql
as $$
begin
  if new.ordnungsgruppe_id is not null and new.spezialgebiet_id is null then
    select og.spezialgebiet_id
      into new.spezialgebiet_id
      from ordnungsgruppe og
     where og.id = new.ordnungsgruppe_id
       and og.mandant_id = new.mandant_id;
  end if;
  return new;
end;
$$;

comment on function app.dokument_spezialgebiet_ableiten() is
  'Setzt spezialgebiet_id aus der Kategorie, sofern noch keines steht. '
  'Abgeleitet, nicht behauptet -- und an einer Stelle statt in vier '
  'Aufrufern.';

create trigger dokument_spezialgebiet
  before insert or update of ordnungsgruppe_id on dokument
  for each row execute function app.dokument_spezialgebiet_ableiten();
