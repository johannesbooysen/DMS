-- Seed-Daten. Ausschliesslich synthetisch: erfundene Namen, Adressen,
-- Objektnummern und Bankverbindungen. Keine echten Personendaten, auch nicht
-- abgewandelt (Projektregel, siehe CLAUDE.md).
--
-- Feste UUIDs, damit Tests darauf verweisen koennen. Die Konstellation ist so
-- gewaehlt, dass die Sichtbarkeitsgrenzen pruefbar werden:
--
--   Anna  -- zustaendig nur fuer Objekt 42
--   Bernd -- Rolle Buchhaltung ohne Objektbezug, sieht alle Objekte in Nord
--   Clara -- Spezialgebiet Versicherung, mandantenweit; sieht den
--            Versicherungsbeleg in Objekt 43, aber nicht dessen uebrige Belege
--   Doris -- anderer Mandant, darf nichts aus Nord sehen
--   Eva   -- Geschaeftsleitung, mandantenweit; bekommt die Freigabestufe

begin;

insert into mandant (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Hausverwaltung Nord (Testdaten)'),
  ('10000000-0000-0000-0000-000000000002', 'Hausverwaltung Sued (Testdaten)');

insert into benutzer (id, mandant_id, name, email) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Anna Ahrens',   'anna@example.invalid'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Bernd Bruns',   'bernd@example.invalid'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'Clara Cordes',  'clara@example.invalid'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002',
   'Doris Dahl',    'doris@example.invalid'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
   'Eva Ebert',     'eva@example.invalid');

insert into spezialgebiet (id, mandant_id, name, farbe) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Versicherung', '#6B4E8C');

-- Clara ist mandantenweit zustaendig (objekt_id NULL)
insert into spezialgebiet_zustaendigkeit (spezialgebiet_id, benutzer_id) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003');

insert into kontenrahmen (id, mandant_id, name) values
  ('35000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Kontenrahmen WEG (Testdaten)');

insert into umlageschluessel (id, mandant_id, name, kurzcode) values
  ('36000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Miteigentumsanteile', 'MEA');

insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung, farbe,
                            spezialgebiet_id, ki_beschreibung) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Betriebskosten', 'BK', 10, '#2F6F4E', null,
   'Laufende Bewirtschaftungskosten: Reinigung, Gartenpflege, Winterdienst, '
   'Hausmeister, Aufzugswartung.'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Versicherungsschaeden', 'VS', 20, '#B3271E',
   '30000000-0000-0000-0000-000000000001',
   'Schadensregulierung nach Leitungswasser, Sturm, Feuer; Gutachten und '
   'Sanierungsrechnungen mit Schadensnummer. Keine laufenden Praemien.');

insert into konto (id, kontenrahmen_id, kontonummer, bezeichnung,
                   umlagefaehig_default, umlageschluessel_default_id,
                   ordnungsgruppe_default_id) values
  ('37000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001',
   '4200', 'Hausreinigung', true, '36000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001');

insert into zahlungsweg (id, mandant_id, name, art, ziel, archiviert_sofort) values
  ('45000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'scan2bank', 'mail', 'zahlungen@bank.example.invalid', false);

insert into objekt (id, mandant_id, objektnummer, bezeichnung, adresse,
                    verwaltungsart, kontenrahmen_id, standard_ordnungsgruppe_id,
                    zahlungsweg_id, eskalationsgrenze_brutto) values
  ('50000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000001',
   '42', 'WEG Lindenweg 3', 'Lindenweg 3, 00000 Musterstadt', 'weg',
   '35000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '45000000-0000-0000-0000-000000000001', 5000.00),
  ('50000000-0000-0000-0000-000000000043', '10000000-0000-0000-0000-000000000001',
   '43', 'WEG Amselgasse 12', 'Amselgasse 12, 00000 Musterstadt', 'weg',
   '35000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '45000000-0000-0000-0000-000000000001', 5000.00),
  ('50000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000002',
   '99', 'MV Birkenallee 7', 'Birkenallee 7, 00000 Andersstadt', 'miet',
   null, null, null, 2500.00);

insert into objekt_zustaendigkeit (objekt_id, benutzer_id, art) values
  ('50000000-0000-0000-0000-000000000042', '20000000-0000-0000-0000-000000000001',
   'hauptverantwortlich'),
  ('50000000-0000-0000-0000-000000000099', '20000000-0000-0000-0000-000000000004',
   'hauptverantwortlich');

insert into kreditor (id, mandant_id, name, ust_id) values
  ('55000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Musterreinigung GmbH', 'DE000000000');

insert into kreditor_bankverbindung (kreditor_id, iban, status) values
  ('55000000-0000-0000-0000-000000000001', 'DE00000000000000000000', 'verifiziert');

insert into stempeltyp (id, mandant_id, name, kurzcode, entscheidung, farbe) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Sachlich richtig', 'SACHL', 'freigabe', '#3B4A80'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Zur Klaerung', 'KLAER', 'klaerung', '#B5741A');

insert into prozessdefinition (id, mandant_id, belegart, version, status, aktiv_ab) values
  ('65000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'rechnung', 1, 'aktiv', now());

insert into prozessstufe (id, definition_id, reihenfolge, stufentyp, bezeichnung,
                          zustaendigkeit_typ, sla_stunden, zustaendigkeit_ref) values
  ('66000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001',
   1, 'sachlich', 'Sachliche Pruefung', 'objektverantwortlich', 72, null),
  ('66000000-0000-0000-0000-000000000002', '65000000-0000-0000-0000-000000000001',
   2, 'rechnerisch', 'Rechnerische Pruefung', 'rolle', 48, '90000000-0000-0000-0000-000000000002'),
  ('66000000-0000-0000-0000-000000000003', '65000000-0000-0000-0000-000000000001',
   3, 'freigabe', 'Freigabe Geschaeftsleitung', 'rolle', 24, '90000000-0000-0000-0000-000000000003'),
  -- Kontierung und Zahlung schliessen die Kette (Konzept 9).
  --
  -- Sie fehlten hier, und das war keine Kleinigkeit: Eine frische
  -- Installation haette einen Ablauf gehabt, der nie zu einer Zahlung fuehrt.
  -- Die Kontierungsmaske und die Zahlungsansicht erscheinen ausschliesslich
  -- an ihrer Stufe -- ohne sie waren beide Masken im Betrieb unerreichbar,
  -- obwohl sie fertig sind. Gefunden von einem E2E-Test, der die Sperre vor
  -- der Zahlung sehen wollte und die Ansicht gar nicht erst fand.
  ('66000000-0000-0000-0000-000000000004', '65000000-0000-0000-0000-000000000001',
   4, 'kontierung', 'Kontierung', 'rolle', 48, '90000000-0000-0000-0000-000000000002'),
  ('66000000-0000-0000-0000-000000000005', '65000000-0000-0000-0000-000000000001',
   5, 'zahlung', 'Zahlungsuebergabe', 'rolle', 24, '90000000-0000-0000-0000-000000000002');

-- Der Ablauf als Blockbaum (ADR 0002): eine Wurzel "nacheinander" mit den
-- drei Stufen als Blaetter. Die Datenmigration in 20260830120000 erzeugt
-- denselben Baum fuer Bestandsdefinitionen -- beim Neuaufbau laeuft sie vor
-- dem Seed und findet nichts vor, deshalb steht er hier ausdruecklich.
insert into prozessknoten (id, definition_id, eltern_id, reihenfolge, knotentyp, stufe_id) values
  ('67000000-0000-0000-0000-000000000001', '65000000-0000-0000-0000-000000000001',
   null, 0, 'nacheinander', null),
  ('67000000-0000-0000-0000-000000000002', '65000000-0000-0000-0000-000000000001',
   '67000000-0000-0000-0000-000000000001', 0, 'stufe',
   '66000000-0000-0000-0000-000000000001'),
  ('67000000-0000-0000-0000-000000000003', '65000000-0000-0000-0000-000000000001',
   '67000000-0000-0000-0000-000000000001', 1, 'stufe',
   '66000000-0000-0000-0000-000000000002'),
  ('67000000-0000-0000-0000-000000000004', '65000000-0000-0000-0000-000000000001',
   '67000000-0000-0000-0000-000000000001', 2, 'stufe',
   '66000000-0000-0000-0000-000000000003'),
  ('67000000-0000-0000-0000-000000000005', '65000000-0000-0000-0000-000000000001',
   '67000000-0000-0000-0000-000000000001', 3, 'stufe',
   '66000000-0000-0000-0000-000000000004'),
  ('67000000-0000-0000-0000-000000000006', '65000000-0000-0000-0000-000000000001',
   '67000000-0000-0000-0000-000000000001', 4, 'stufe',
   '66000000-0000-0000-0000-000000000005');

-- ---------------------------------------------------------------------------
-- Stempel: welche Entscheidung an welcher Stufe, und wer darf sie treffen
-- ---------------------------------------------------------------------------

insert into stempeltyp (id, mandant_id, name, kurzcode, entscheidung, farbe,
                        kommentar_pflicht) values
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'Rechnerisch richtig', 'RECHN', 'freigabe', '#3B4A80', false),
  ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   'Freigegeben', 'FREI', 'freigabe', '#2F6F4E', false),
  ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
   'Abgelehnt', 'ABL', 'ablehnung', '#B3271E', true),
  -- Eigene Stempel fuer Kontierung und Zahlung.
  --
  -- Nicht "Freigegeben" wiederverwendet: Den darf nur die
  -- Geschaeftsleitung setzen (`stempel_recht`), und die Zahlungsuebergabe
  -- gehoert der Buchhaltung. Mit dem geliehenen Stempel waere die Stufe
  -- eine, die niemand abschliessen kann -- genau der Fall, den Konzept 8.7
  -- beschreibt.
  ('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
   'Kontiert', 'KONT', 'freigabe', '#3B4A80', false),
  ('60000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
   'Zur Zahlung uebergeben', 'ZAHL', 'freigabe', '#2F6F4E', false);

-- Welche Stempel an welcher Stufe moeglich sind
insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung) values
  -- Sachliche Pruefung
  ('66000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 0),
  ('66000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 1),
  ('66000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000005', 2),
  -- Rechnerische Pruefung
  ('66000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003', 0),
  ('66000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 1),
  -- Freigabe Geschaeftsleitung
  ('66000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000004', 0),
  ('66000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000002', 1),
  ('66000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000005', 2),
  -- Kontierung und Zahlung: je ein Weiter und der Weg in die Klaerung. Kein
  -- Ablehnen mehr -- nach der Freigabe der Geschaeftsleitung ist das eine
  -- Entscheidung, die zurueckgehen muss, keine, die man hier trifft.
  ('66000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000006', 0),
  ('66000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000002', 1),
  ('66000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000007', 0),
  ('66000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000002', 1);

-- Drei Belege in Nord, einer in Sued.
--   d1  Objekt 42, Betriebskosten          -> Anna sieht ihn
--   d2  Objekt 43, Versicherungsschaeden   -> Clara sieht ihn, Anna nicht
--   d3  Objekt 43, Betriebskosten          -> weder Anna noch Clara
--   d9  Objekt 99, anderer Mandant         -> nur Doris
insert into dokument (id, mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                      spezialgebiet_id, eingangskanal, inhalt_hash,
                      storage_praefix, seitenzahl, ampel_gesamt, status) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000042', 'rechnung',
   '40000000-0000-0000-0000-000000000001', null, 'mail',
   'hash-d1', 'nord/42/2026/d1', 2, 'gruen', 'laufend'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000043', 'rechnung',
   '40000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000001', 'scan',
   'hash-d2', 'nord/43/2026/d2', 5, 'orange', 'laufend'),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000043', 'rechnung',
   '40000000-0000-0000-0000-000000000001', null, 'mail',
   'hash-d3', 'nord/43/2026/d3', 1, 'gruen', 'laufend'),
  ('70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000099', 'rechnung', null, null, 'upload',
   'hash-d9', 'sued/99/2026/d9', 1, 'gruen', 'laufend');

insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                             rechnungsdatum, netto, steuer, brutto, wirtschaftsjahr) values
  ('70000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001',
   'RE-2026-0001', date '2026-03-14', 1042.02, 197.98, 1240.00, 2026);

insert into dokument_seite (dokument_id, seite, text, breite, hoehe) values
  ('70000000-0000-0000-0000-000000000001', 1,
   'Musterreinigung GmbH Rechnung RE-2026-0001 Hausreinigung Lindenweg 3', 595, 842),
  ('70000000-0000-0000-0000-000000000001', 2,
   'Zahlbar innerhalb von 14 Tagen ohne Abzug.', 595, 842);

insert into dokument_lauf (id, dokument_id, definition_id, definition_version,
                           aktuelle_stufe_id) values
  ('75000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '65000000-0000-0000-0000-000000000001', 1,
   '66000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002',
   '65000000-0000-0000-0000-000000000001', 1,
   '66000000-0000-0000-0000-000000000001');

insert into aufgabe (lauf_id, stufe_id, zugewiesen_benutzer, faellig_am) values
  ('75000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', now() + interval '3 days'),
  ('75000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000003', now() + interval '3 days');

-- ---------------------------------------------------------------------------
-- Rollen
--
-- Anna traegt die Objektzustaendigkeit fuer Objekt 42 und braucht deshalb
-- keine objektbezogene Rollenzuweisung -- die Sicht kommt aus der
-- Zustaendigkeit. Bernd traegt keine Zustaendigkeit und sieht trotzdem
-- alles: mandantenweite Rolle ohne Objektbezug.
-- Clara bekommt bewusst keine Rollenzuweisung. Ihre Sicht entsteht
-- ausschliesslich ueber die Spezialgebietszustaendigkeit -- eine
-- objektbezogene Rolle wuerde ihr das ganze Objekt 43 oeffnen.
-- ---------------------------------------------------------------------------

insert into rolle (id, mandant_id, name, kurzcode, beschreibung) values
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Objektbearbeitung', 'OB', 'Sachliche Pruefung und Bearbeitung am eigenen Objekt.'),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Buchhaltung', 'BH', 'Mandantenweite Sicht, rechnerische Pruefung und Kontierung.'),
  ('90000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'Geschaeftsleitung', 'GL', 'Freigabe ueber der Eskalationsgrenze, Konfiguration.');

insert into rolle_recht (rolle_id, aktion, belegart, ordnungsgruppe_id) values
  ('90000000-0000-0000-0000-000000000001', 'ansehen',    null, null),
  ('90000000-0000-0000-0000-000000000001', 'bearbeiten', null, null),
  ('90000000-0000-0000-0000-000000000001', 'stempeln',   null, null),
  ('90000000-0000-0000-0000-000000000002', 'ansehen',    null, null),
  ('90000000-0000-0000-0000-000000000002', 'kontieren',  null, null),
  ('90000000-0000-0000-0000-000000000002', 'stempeln',   null, null),
  ('90000000-0000-0000-0000-000000000003', 'ansehen',    null, null),
  ('90000000-0000-0000-0000-000000000003', 'stempeln',   null, null),
  ('90000000-0000-0000-0000-000000000003', 'prozess_konfigurieren', null, null),
  ('90000000-0000-0000-0000-000000000003', 'delegieren', null, null);

insert into benutzer_rolle_objekt (benutzer_id, rolle_id, objekt_id) values
  -- Anna: Objektbearbeitung, ausdruecklich nur Objekt 42
  ('20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000042'),
  -- Bernd: Buchhaltung, mandantenweit
  ('20000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', null),
  -- Eva: Geschaeftsleitung, mandantenweit
  ('20000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000003', null);

-- Wer darf welchen Stempel setzen. Als Matrix Stempeltyp x Rolle gedacht
-- (Konzept 8.3), hier als Zeilen.
insert into stempel_recht (stempeltyp_id, rolle_id) values
  -- Objektbearbeitung: sachlich richtig, zur Klaerung, ablehnen
  ('60000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000001'),
  -- Buchhaltung: rechnerisch richtig, zur Klaerung
  ('60000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002'),
  -- Geschaeftsleitung: freigeben, ablehnen, zur Klaerung
  ('60000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000003'),
  -- Buchhaltung: kontieren und uebergeben
  ('60000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Einheit, Mieter und Kontierung
--
-- Die Konstellation prueft den Mieterwechsel: Meike mietet bis Ende Maerz
-- 2026, Nico ab April. Jeder darf nur die Belege sehen, deren
-- Leistungszeitraum in seine Mietzeit faellt -- und nur, wenn der Beleg
-- ueberhaupt eine umlagefaehige Zeile hat.
-- ---------------------------------------------------------------------------

insert into konto (id, kontenrahmen_id, kontonummer, bezeichnung,
                   umlagefaehig_default) values
  ('37000000-0000-0000-0000-000000000002', '35000000-0000-0000-0000-000000000001',
   '4000', 'Verwalterverguetung', false);

insert into einheit (id, objekt_id, einheitsnummer, lage, typ, mea, wohnflaeche) values
  ('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000042',
   'WE 1', 'Erdgeschoss links', 'wohnung', 0.2500, 72.40);

insert into person (id, mandant_id, art, name, email) values
  ('85000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'mieter', 'Meike Meier', 'meike@example.invalid'),
  ('85000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'mieter', 'Nico Neumann', 'nico@example.invalid');

insert into person_bezug (person_id, objekt_id, einheit_id, art,
                          gueltig_von, gueltig_bis) values
  ('85000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000042',
   '80000000-0000-0000-0000-000000000001', 'mieter',
   date '2025-01-01', date '2026-03-31'),
  ('85000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000042',
   '80000000-0000-0000-0000-000000000001', 'mieter',
   date '2026-04-01', null);

-- d1 liegt in Meikes Mietzeit
update dokument
   set leistung_von = date '2026-01-01', leistung_bis = date '2026-03-31'
 where id = '70000000-0000-0000-0000-000000000001';

-- d4 liegt in Nicos Mietzeit, d5 ist nicht umlagefaehig
insert into dokument (id, mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                      eingangskanal, inhalt_hash, storage_praefix, seitenzahl,
                      leistung_von, leistung_bis, ampel_gesamt, status) values
  ('70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000042', 'rechnung',
   '40000000-0000-0000-0000-000000000001', 'mail', 'hash-d4',
   'nord/42/2026/d4', 1, date '2026-05-01', date '2026-05-31', 'gruen', 'laufend'),
  ('70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000042', 'rechnung',
   '40000000-0000-0000-0000-000000000001', 'mail', 'hash-d5',
   'nord/42/2026/d5', 1, date '2026-02-01', date '2026-02-28', 'gruen', 'laufend');

insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                             rechnungsdatum, netto, steuer, brutto, wirtschaftsjahr) values
  ('70000000-0000-0000-0000-000000000004', '55000000-0000-0000-0000-000000000001',
   'RE-2026-0004', date '2026-06-02', 252.10, 47.90, 300.00, 2026),
  ('70000000-0000-0000-0000-000000000005', '55000000-0000-0000-0000-000000000001',
   'RE-2026-0005', date '2026-03-02', 420.17, 79.83, 500.00, 2026);

-- d1: zwei umlagefaehige Zeilen, Summe genau 1.240,00 -- der Summenzwang
-- muss dafuer erfuellt sein.
insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                        steuersatz, betrag_brutto, umlagefaehig,
                        umlageschluessel_id, quelle) values
  ('70000000-0000-0000-0000-000000000001', 1, '37000000-0000-0000-0000-000000000001',
   672.27, 19.00, 800.00, true, '36000000-0000-0000-0000-000000000001', 'muster'),
  ('70000000-0000-0000-0000-000000000001', 2, '37000000-0000-0000-0000-000000000001',
   369.75, 19.00, 440.00, true, '36000000-0000-0000-0000-000000000001', 'mensch'),
  ('70000000-0000-0000-0000-000000000004', 1, '37000000-0000-0000-0000-000000000001',
   252.10, 19.00, 300.00, true, '36000000-0000-0000-0000-000000000001', 'muster'),
  -- nicht umlagefaehig: Verwalterverguetung
  ('70000000-0000-0000-0000-000000000005', 1, '37000000-0000-0000-0000-000000000002',
   420.17, 19.00, 500.00, false, null, 'mensch');

commit;
