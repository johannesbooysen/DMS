-- Der Kreditor bekommt eine E-Mail-Adresse -- damit die Systemaktion
-- "Abtretungserklaerung an die ausfuehrende Firma" (Konzept 10) einen
-- Empfaenger hat.
--
-- Bis hierher trug das Stammdatum Name, Steuernummern und Status; die
-- Post an den Kreditor lief ausschliesslich ueber die Zahlungswege
-- (scan2bank an die Bank, nicht an ihn). Eine Adresse am Kreditor ist ein
-- personenbezogenes Datum wie der Name -- dieselbe Verarbeitungstaetigkeit
-- im Verzeichnis, dieselbe Lese- und Schreibpolicy (stammdaten_pflegen).
--
-- Die Form wird hier geprueft, nicht nur in der Anwendung: Eine Adresse,
-- die keine ist, wuerde erst beim Versand auffallen -- und der laeuft
-- nachts im Worker.

alter table kreditor add column email text
  check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

comment on column kreditor.email is
  'Empfaenger fuer Systemaktionen (Abtretungserklaerung, Rueckfragen). '
  'Leer heisst: Der Kreditor ist als Empfaenger nicht erreichbar, und eine '
  'Systemaktion an ihn meldet in den Fehlerkorb.';
