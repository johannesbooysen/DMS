-- Nachgezogene Pruefregel auf datierten Zustaendigkeiten
--
-- person_bezug und benutzer_rolle_objekt pruefen, dass ein Zeitraum nicht
-- rueckwaerts laeuft; objekt_zustaendigkeit tat es nicht. Die Spalten sind
-- seit dem Kernschema vorhanden, die Regel fehlte -- ein vertauschtes
-- Datumspaar haette dort unbemerkt eine Zustaendigkeit erzeugt, die nie
-- gilt und trotzdem in jeder Uebersicht auftaucht.

alter table objekt_zustaendigkeit
  add constraint objekt_zustaendigkeit_zeitraum
  check (gueltig_bis is null or gueltig_bis >= gueltig_von);

comment on constraint objekt_zustaendigkeit_zeitraum on objekt_zustaendigkeit is
  'Gleiches Datum ist zulaessig -- eine Zustaendigkeit fuer genau einen Tag '
  'ist fachlich sinnvoll. Nur die Umkehrung ist ausgeschlossen.';
