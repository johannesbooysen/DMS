-- Pflichtfelder je Belegart -- Konfiguration statt Code.
--
-- Konzept 14: "Extraktionsvertrauen = Minimum der Confidence ueber die
-- Pflichtfelder der Belegart." Bis hierher stand diese Liste im Quelltext
-- (kreditor_name, rechnungsnummer, rechnungsdatum, brutto). Welche Angaben
-- ein Haus unbedingt erfasst haben will, ist aber eine fachliche
-- Entscheidung je Haus -- die eine Verwaltung verlangt den
-- Leistungszeitraum fuer die Abrechnung, die andere die IBAN fuer den
-- Betrugsschutz. Deshalb ein Stammdatum.
--
-- Wirkung: Die Extraktions-Ampel wird ueber diese Felder gerechnet; das
-- Nachtragen kennzeichnet sie und stellt die Ampel auf gruen, sobald ein
-- Mensch alle eingetragen hat. Keine Zeile fuer eine Belegart heisst: kein
-- Pflichtfeld -- dann ist jede Erkennung gruen. Die Seite sagt das dazu.
--
-- Zwei Policies, wie bei jedem Stammdatum seit 20260903100000: Lesen im
-- Mandanten, Schreiben nur mit stammdaten_pflegen. Kein Personenbezug --
-- die Tabelle traegt Feldnamen.

create table pflichtfeld (
  id          uuid primary key default gen_random_uuid(),
  mandant_id  uuid not null references mandant(id),
  belegart    text not null,
  feldname    text not null check (feldname in (
                'kreditor_name', 'kreditor_ust_id', 'rechnungsnummer', 'rechnungsdatum',
                'leistung_von', 'leistung_bis', 'netto', 'steuer', 'brutto',
                'iban_im_beleg', 'zahlungsziel', 'skonto_prozent', 'skonto_bis')),
  unique (mandant_id, belegart, feldname)
);

comment on table pflichtfeld is
  'Welche Felder je Belegart erfasst sein muessen (Konzept 14). Stammdatum, keine Personen.';

alter table pflichtfeld enable row level security;

create policy pflichtfeld_lesen on pflichtfeld for select
  using (mandant_id = (select app.mein_mandant()));
create policy pflichtfeld_schreiben on pflichtfeld for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

grant select, insert, update, delete on pflichtfeld to dms_app;

-- Bestehende Haeuser bekommen die bisherige Liste aus dem Quelltext, damit
-- sich mit dieser Migration an keiner Ampel etwas aendert.
insert into pflichtfeld (mandant_id, belegart, feldname)
select m.id, 'rechnung', f.feldname
  from mandant m
 cross join (values ('kreditor_name'), ('rechnungsnummer'), ('rechnungsdatum'), ('brutto')) as f(feldname)
on conflict do nothing;
