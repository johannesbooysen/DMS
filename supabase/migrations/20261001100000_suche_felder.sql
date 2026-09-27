-- Suche ueber Felder: Rechnungsnummer, Kreditorname, IBAN, Betrag.
--
-- Bis hierher fand die Suche nur Woerter im Seitentext. Wer eine
-- Rechnungsnummer, einen Namensteil ("park" fuer Parkster) oder einen
-- Betrag kannte, fand nichts -- die Felder standen in rechnung_fakten und
-- kreditor, und dort suchte niemand. Jetzt sucht `suchen` dort mit, als
-- Teilstueck: Dafuer braucht `ilike '%…%'` einen Trigramm-Index, sonst ist
-- es ein Seq Scan ueber eine Million Zeilen (pg_trgm liegt bei Supabase und
-- bei Postgres 16/17 im contrib).
--
-- Betraege werden exakt verglichen (Brutto oder Netto); ein B-Baum genuegt.
--
-- Gemessen wird das in scripts/belegliste-messen.ts mit fuenf Suchbegriffen
-- (Nummer, Namensteil, Betrag, haeufiges und seltenes Wort); die Zahlen
-- kommen nach docs/messungen.md. Ohne Zahl keine Optimierung -- und ohne
-- Index keine brauchbare Teilstuecksuche.

create extension if not exists pg_trgm;

create index if not exists rechnung_fakten_nummer_trgm_idx
  on rechnung_fakten using gin (rechnungsnummer gin_trgm_ops);
create index if not exists rechnung_fakten_iban_trgm_idx
  on rechnung_fakten using gin (iban_im_beleg gin_trgm_ops);
create index if not exists kreditor_name_trgm_idx
  on kreditor using gin (name gin_trgm_ops);
create index if not exists rechnung_fakten_brutto_idx on rechnung_fakten (brutto);
create index if not exists rechnung_fakten_netto_idx on rechnung_fakten (netto);
