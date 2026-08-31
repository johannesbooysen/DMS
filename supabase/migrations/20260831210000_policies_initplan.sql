-- Die Policies rufen ihre Funktionen je Zeile auf -- und das kostet Minuten
--
-- Gefunden beim Messen der Belegliste gegen eine Million Dokumente. Der
-- objektuebergreifende Feed brauchte **92 Sekunden**. Nach dieser Migration
-- sind es **140 Millisekunden**.
--
-- Konzept 21 warnt vor der falschen RLS-Strategie und schreibt vor, die
-- Objektsichtbarkeit ueber eine `stable security definer`-Funktion
-- aufzuloesen statt ueber eine Unterabfrage je Zeile. Genau das stand hier
-- auch. Die Warnung greift trotzdem zu kurz:
--
--   **`stable` heisst nicht `wird einmal ausgewertet`.** Es heisst nur, dass
--   die Funktion innerhalb eines Statements dasselbe Ergebnis liefert.
--   PostgreSQL darf das Ergebnis wiederverwenden -- es muss aber nicht, und
--   im Zeilenfilter einer Policy tut es das nicht. Der Ausfuehrungsplan zeigt
--   es unmissverstaendlich:
--
--     Filter: (... AND (objekt_id = ANY (app.meine_objekte())) ...)
--
--   `app.meine_objekte()` braucht allein 10 ms. Bei 100.000 gefilterten
--   Zeilen sind das 1.000 Sekunden Funktionsaufrufe fuer eine Trefferliste.
--
-- Die Abhilfe ist eine Klammer: Als **unkorrelierte Unterabfrage**
-- `(select app.meine_objekte())` wird daraus ein InitPlan -- einmal je
-- Statement berechnet, danach eine Konstante. Der Plan zeigt dann
--
--     Index Cond: (objekt_id = ANY ((InitPlan 2).col1))
--
-- Der Zusatz `::uuid[]` ist keine Zierde: Ohne ihn liest der Parser
-- `= any ((select ...))` als Mengenform `ANY (subquery)` und der Index faellt
-- weg.
--
-- Betroffen waren 49 von 65 Policies. Sie werden hier alle umgestellt -- nicht
-- nur die auf `dokument`: Jede Tabelle waechst irgendwann, und eine Policy,
-- die erst bei 100.000 Zeilen auffaellt, faellt zur schlechtesten Zeit auf.
--
-- Erzeugt aus `pg_policies`, damit die Bedingungen unveraendert bleiben und
-- sich nur die Form aendert.
--
-- Gemessen mit `npx tsx scripts/belegliste-messen.ts`; die Zahlen stehen in
-- docs/messungen.md.


drop policy anmelde_ereignis_eigene on anmelde_ereignis;
create policy anmelde_ereignis_eigene on anmelde_ereignis for select
  using ((benutzer_id = (select app.mein_benutzer())));

drop policy aufbewahrungsfrist_sicht on aufbewahrungsfrist;
create policy aufbewahrungsfrist_sicht on aufbewahrungsfrist for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy aufgabe_sicht on aufgabe;
create policy aufgabe_sicht on aufgabe for all
  using (((zugewiesen_benutzer = (select app.mein_benutzer())) OR (zugewiesen_gruppe = ANY ((select app.meine_gruppen())::uuid[])) OR (EXISTS ( SELECT 1
   FROM dokument_lauf l
  WHERE (l.id = aufgabe.lauf_id)))))
  with check ((EXISTS ( SELECT 1
   FROM dokument_lauf l
  WHERE (l.id = aufgabe.lauf_id))));

drop policy belegmerkmal_sicht on belegmerkmal;
create policy belegmerkmal_sicht on belegmerkmal for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy benutzer_sicht on benutzer;
create policy benutzer_sicht on benutzer for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy benutzer_rolle_objekt_sicht on benutzer_rolle_objekt;
create policy benutzer_rolle_objekt_sicht on benutzer_rolle_objekt for all
  using ((EXISTS ( SELECT 1
   FROM benutzer b
  WHERE ((b.id = benutzer_rolle_objekt.benutzer_id) AND (b.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM benutzer b
  WHERE ((b.id = benutzer_rolle_objekt.benutzer_id) AND (b.mandant_id = (select app.mein_mandant()))))));

drop policy delegation_anlegen on delegation;
create policy delegation_anlegen on delegation for insert
  with check (((mandant_id = (select app.mein_mandant())) AND (erstellt_von = (select app.mein_benutzer())) AND ((von_benutzer = (select app.mein_benutzer())) OR app.darf('delegieren'::text))));

drop policy delegation_sicht on delegation;
create policy delegation_sicht on delegation for select
  using ((mandant_id = (select app.mein_mandant())));

drop policy delegation_widerrufen on delegation;
create policy delegation_widerrufen on delegation for update
  using (((mandant_id = (select app.mein_mandant())) AND ((von_benutzer = (select app.mein_benutzer())) OR app.darf('delegieren'::text))))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy dokument_aendern on dokument;
create policy dokument_aendern on dokument for update
  using (((mandant_id = (select app.mein_mandant())) AND ((objekt_id IS NULL) OR (objekt_id = ANY ((select app.meine_objekte())::uuid[])) OR (spezialgebiet_id = ANY ((select app.meine_spezialgebiete())::uuid[])))))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy dokument_anlegen on dokument;
create policy dokument_anlegen on dokument for insert
  with check ((mandant_id = (select app.mein_mandant())));

drop policy dokument_lesen on dokument;
create policy dokument_lesen on dokument for select
  using (((NOT eingeschraenkt) AND (mandant_id = (select app.mein_mandant())) AND ((objekt_id IS NULL) OR (objekt_id = ANY ((select app.meine_objekte())::uuid[])) OR (spezialgebiet_id = ANY ((select app.meine_spezialgebiete())::uuid[])))));

drop policy dokument_loeschen on dokument;
create policy dokument_loeschen on dokument for delete
  using (((mandant_id = (select app.mein_mandant())) AND ((objekt_id IS NULL) OR (objekt_id = ANY ((select app.meine_objekte())::uuid[])) OR (spezialgebiet_id = ANY ((select app.meine_spezialgebiete())::uuid[])))));

drop policy einheit_sicht on einheit;
create policy einheit_sicht on einheit for all
  using ((objekt_id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((objekt_id = ANY ((select app.meine_objekte())::uuid[])));

drop policy einschraenkung_sicht on einschraenkung;
create policy einschraenkung_sicht on einschraenkung for select
  using ((mandant_id = (select app.mein_mandant())));

drop policy gruppe_sicht on gruppe;
create policy gruppe_sicht on gruppe for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy gruppe_mitglied_sicht on gruppe_mitglied;
create policy gruppe_mitglied_sicht on gruppe_mitglied for all
  using ((EXISTS ( SELECT 1
   FROM gruppe g
  WHERE ((g.id = gruppe_mitglied.gruppe_id) AND (g.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM gruppe g
  WHERE ((g.id = gruppe_mitglied.gruppe_id) AND (g.mandant_id = (select app.mein_mandant()))))));

drop policy kontenrahmen_sicht on kontenrahmen;
create policy kontenrahmen_sicht on kontenrahmen for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy kontierungs_muster_sicht on kontierungs_muster;
create policy kontierungs_muster_sicht on kontierungs_muster for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy konto_sicht on konto;
create policy konto_sicht on konto for all
  using ((EXISTS ( SELECT 1
   FROM kontenrahmen k
  WHERE ((k.id = konto.kontenrahmen_id) AND (k.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM kontenrahmen k
  WHERE ((k.id = konto.kontenrahmen_id) AND (k.mandant_id = (select app.mein_mandant()))))));

drop policy korrektur_ereignis_anlegen on korrektur_ereignis;
create policy korrektur_ereignis_anlegen on korrektur_ereignis for insert
  with check (((benutzer_id = (select app.mein_benutzer())) AND (EXISTS ( SELECT 1
   FROM dokument d
  WHERE (d.id = korrektur_ereignis.dokument_id)))));

drop policy kreditor_sicht on kreditor;
create policy kreditor_sicht on kreditor for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy kreditor_bankverbindung_sicht on kreditor_bankverbindung;
create policy kreditor_bankverbindung_sicht on kreditor_bankverbindung for all
  using ((EXISTS ( SELECT 1
   FROM kreditor k
  WHERE ((k.id = kreditor_bankverbindung.kreditor_id) AND (k.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM kreditor k
  WHERE ((k.id = kreditor_bankverbindung.kreditor_id) AND (k.mandant_id = (select app.mein_mandant()))))));

drop policy mandant_sicht on mandant;
create policy mandant_sicht on mandant for select
  using ((id = (select app.mein_mandant())));

drop policy objekt_sicht on objekt;
create policy objekt_sicht on objekt for all
  using ((id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy objekt_zustaendigkeit_sicht on objekt_zustaendigkeit;
create policy objekt_zustaendigkeit_sicht on objekt_zustaendigkeit for all
  using ((objekt_id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((objekt_id = ANY ((select app.meine_objekte())::uuid[])));

drop policy ordnungsgruppe_sicht on ordnungsgruppe;
create policy ordnungsgruppe_sicht on ordnungsgruppe for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy person_sicht on person;
create policy person_sicht on person for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy person_bezug_sicht on person_bezug;
create policy person_bezug_sicht on person_bezug for all
  using ((objekt_id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((objekt_id = ANY ((select app.meine_objekte())::uuid[])));

drop policy prozess_override_sicht on prozess_override;
create policy prozess_override_sicht on prozess_override for all
  using ((objekt_id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((objekt_id = ANY ((select app.meine_objekte())::uuid[])));

drop policy prozessdefinition_sicht on prozessdefinition;
create policy prozessdefinition_sicht on prozessdefinition for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy prozessdefinition_ereignis_anlegen on prozessdefinition_ereignis;
create policy prozessdefinition_ereignis_anlegen on prozessdefinition_ereignis for insert
  with check (((benutzer_id = (select app.mein_benutzer())) AND (EXISTS ( SELECT 1
   FROM prozessdefinition p
  WHERE ((p.id = prozessdefinition_ereignis.definition_id) AND (p.mandant_id = (select app.mein_mandant())))))));

drop policy prozessdefinition_ereignis_lesen on prozessdefinition_ereignis;
create policy prozessdefinition_ereignis_lesen on prozessdefinition_ereignis for select
  using ((EXISTS ( SELECT 1
   FROM prozessdefinition p
  WHERE ((p.id = prozessdefinition_ereignis.definition_id) AND (p.mandant_id = (select app.mein_mandant()))))));

drop policy prozessknoten_sicht on prozessknoten;
create policy prozessknoten_sicht on prozessknoten for all
  using ((EXISTS ( SELECT 1
   FROM prozessdefinition p
  WHERE ((p.id = prozessknoten.definition_id) AND (p.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM prozessdefinition p
  WHERE ((p.id = prozessknoten.definition_id) AND (p.mandant_id = (select app.mein_mandant()))))));

drop policy prozessstufe_sicht on prozessstufe;
create policy prozessstufe_sicht on prozessstufe for all
  using ((EXISTS ( SELECT 1
   FROM prozessdefinition p
  WHERE ((p.id = prozessstufe.definition_id) AND (p.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM prozessdefinition p
  WHERE ((p.id = prozessstufe.definition_id) AND (p.mandant_id = (select app.mein_mandant()))))));

drop policy prozessstufe_stempeltyp_sicht on prozessstufe_stempeltyp;
create policy prozessstufe_stempeltyp_sicht on prozessstufe_stempeltyp for all
  using ((EXISTS ( SELECT 1
   FROM (prozessstufe s
     JOIN prozessdefinition p ON ((p.id = s.definition_id)))
  WHERE ((s.id = prozessstufe_stempeltyp.stufe_id) AND (p.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM (prozessstufe s
     JOIN prozessdefinition p ON ((p.id = s.definition_id)))
  WHERE ((s.id = prozessstufe_stempeltyp.stufe_id) AND (p.mandant_id = (select app.mein_mandant()))))));

drop policy rolle_sicht on rolle;
create policy rolle_sicht on rolle for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy rolle_recht_sicht on rolle_recht;
create policy rolle_recht_sicht on rolle_recht for all
  using ((EXISTS ( SELECT 1
   FROM rolle r
  WHERE ((r.id = rolle_recht.rolle_id) AND (r.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM rolle r
  WHERE ((r.id = rolle_recht.rolle_id) AND (r.mandant_id = (select app.mein_mandant()))))));

drop policy sitzung_eigene on sitzung;
create policy sitzung_eigene on sitzung for select
  using ((benutzer_id = (select app.mein_benutzer())));

drop policy spezialgebiet_sicht on spezialgebiet;
create policy spezialgebiet_sicht on spezialgebiet for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy spezialgebiet_zustaendigkeit_sicht on spezialgebiet_zustaendigkeit;
create policy spezialgebiet_zustaendigkeit_sicht on spezialgebiet_zustaendigkeit for all
  using ((EXISTS ( SELECT 1
   FROM spezialgebiet s
  WHERE ((s.id = spezialgebiet_zustaendigkeit.spezialgebiet_id) AND (s.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM spezialgebiet s
  WHERE ((s.id = spezialgebiet_zustaendigkeit.spezialgebiet_id) AND (s.mandant_id = (select app.mein_mandant()))))));

drop policy stempel_ereignis_anlegen on stempel_ereignis;
create policy stempel_ereignis_anlegen on stempel_ereignis for insert
  with check (((benutzer_id = (select app.mein_benutzer())) AND (EXISTS ( SELECT 1
   FROM dokument_lauf l
  WHERE (l.id = stempel_ereignis.lauf_id)))));

drop policy stempel_recht_sicht on stempel_recht;
create policy stempel_recht_sicht on stempel_recht for all
  using ((EXISTS ( SELECT 1
   FROM stempeltyp s
  WHERE ((s.id = stempel_recht.stempeltyp_id) AND (s.mandant_id = (select app.mein_mandant()))))))
  with check ((EXISTS ( SELECT 1
   FROM stempeltyp s
  WHERE ((s.id = stempel_recht.stempeltyp_id) AND (s.mandant_id = (select app.mein_mandant()))))));

drop policy stempeltyp_sicht on stempeltyp;
create policy stempeltyp_sicht on stempeltyp for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy umlageschluessel_sicht on umlageschluessel;
create policy umlageschluessel_sicht on umlageschluessel for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy vertrag_sicht on vertrag;
create policy vertrag_sicht on vertrag for all
  using ((objekt_id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((objekt_id = ANY ((select app.meine_objekte())::uuid[])));

drop policy vorgang_sicht on vorgang;
create policy vorgang_sicht on vorgang for all
  using ((objekt_id = ANY ((select app.meine_objekte())::uuid[])))
  with check ((objekt_id = ANY ((select app.meine_objekte())::uuid[])));

drop policy zahlungsweg_sicht on zahlungsweg;
create policy zahlungsweg_sicht on zahlungsweg for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));

drop policy zuordnungs_merkmal_sicht on zuordnungs_merkmal;
create policy zuordnungs_merkmal_sicht on zuordnungs_merkmal for all
  using ((mandant_id = (select app.mein_mandant())))
  with check ((mandant_id = (select app.mein_mandant())));
