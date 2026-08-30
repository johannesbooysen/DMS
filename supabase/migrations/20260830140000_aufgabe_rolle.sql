-- Aufgaben an eine Rolle
--
-- prozessstufe kennt zustaendigkeit_typ = 'rolle' seit dem Kernschema, aber
-- aufgabe konnte nur an Benutzer oder Gruppe gehen. Die Folge war im
-- laufenden System sofort sichtbar: Nach der sachlichen Pruefung verschwand
-- der Beleg aus dem Postfach des Bearbeiters -- und tauchte bei niemandem
-- wieder auf. Er lag still.
--
-- Eine Aufgabe an eine Rolle ist ein Pool, wie das Spezialgebiets-Postfach:
-- Alle, die die Rolle fuer dieses Objekt tragen, sehen sie; wer sie
-- uebernimmt, sperrt sie fuer eine Weile (Konzept 8.6).

alter table aufgabe add column zugewiesen_rolle uuid references rolle(id);

create index aufgabe_rolle_idx on aufgabe (zugewiesen_rolle, status)
  where status in ('offen','in_arbeit');

comment on column aufgabe.zugewiesen_rolle is
  'Pool ueber die Rolle. Wer die Rolle fuer das Objekt des Belegs traegt, '
  'sieht die Aufgabe -- geprueft gegen benutzer_rolle_objekt, damit eine '
  'objektbezogene Rolle nicht plötzlich mandantenweit wirkt.';

-- Genau ein Traeger je Aufgabe -- oder keiner, solange die Zustaendigkeit
-- nicht aufloesbar ist (etwa 'system' oder 'extern').
alter table aufgabe add constraint aufgabe_traeger
  check (num_nonnulls(zugewiesen_benutzer, zugewiesen_gruppe, zugewiesen_rolle) <= 1);
