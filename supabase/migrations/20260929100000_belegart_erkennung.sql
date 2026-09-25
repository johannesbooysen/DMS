-- Belegart aus dem Inhalt -- woher die Belegart eines Belegs stammt.
--
-- Bis hierher kam sie vom Eingangsweg (Upload = Rechnung, Eingangsquelle =
-- ihr Stammdatum). Jetzt liest der Worker sie aus dem Text (src/lernen/
-- belegart.ts) und stellt sie um, wenn die Erkennung eindeutig ist und der
-- Beleg noch keine Entscheidung traegt; ein Mensch kann sie am Arbeitsplatz
-- setzen. Dieselbe Bauart wie bei kategorie_quelle (20260922100000): Die
-- Quelle sagt, wer entschieden hat, die Begruendung, warum -- und was ein
-- Mensch gesetzt hat, stellt keine Erkennung mehr um.

alter table dokument
  add column belegart_quelle text not null default 'eingang'
    check (belegart_quelle in ('eingang', 'erkannt', 'mensch')),
  add column belegart_begruendung text;

comment on column dokument.belegart_quelle is
  'eingang = vom Eingangsweg vorgegeben (aenderbar), erkannt = aus dem Text, mensch = von Hand gesetzt (fest).';
comment on column dokument.belegart_begruendung is
  'Warum diese Belegart gilt -- die erkannten Woerter, oder der Hinweis, warum nicht umgestellt wurde.';
