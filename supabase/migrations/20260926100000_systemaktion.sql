-- Systemaktionen (Konzept 8.4, 10, 11): eine Stufe, die niemand stempelt.
--
-- Die Diagramme im Konzept kennen Stufen wie "Mail mit Abtretungserklaerung
-- an die ausfuehrende Firma" oder "Erfassungsmeldung an die
-- Technik-Datenbank". Bis hierher gab es den Stufentyp `systemaktion` und
-- die Zustaendigkeit `system` -- aber nichts, was an der Stufe stand, und
-- keine Stelle in der Engine, die etwas tat. Die Aufgabe entstand, hatte
-- niemanden, und der Lauf blieb dort stehen.
--
-- Jetzt traegt die Stufe ihre Aktion als jsonb:
--   { "vorlage": "abtretung",
--     "empfaenger": "adresse" | "objektverantwortlich",
--     "adresse": "technik@example.invalid" }      -- nur bei "adresse"
--
-- Als jsonb und nicht als drei Spalten, aus demselben Grund wie die
-- Bedingungen am Knoten: Die Weissliste der erlaubten Felder steht im Code
-- (`src/workflow/systemaktion.ts`), und eine zweite Aktionsart (Export,
-- Drittsystem) ist dann ein weiterer Schluessel, keine Migration.
--
-- **Die Vorlage wird ueber ihren Schluessel referenziert**, nicht ueber die
-- Kennung: Vorlagen sind je Mandant, und eine Ablaufdefinition wird kopiert
-- (Entwurf aus Fassung). Der Schluessel bleibt dabei gueltig, eine Kennung
-- wuerde nach dem Kopieren auf die alte Fassung zeigen.

alter table prozessstufe add column systemaktion jsonb;

alter table prozessstufe add constraint prozessstufe_systemaktion_typ
  check (systemaktion is null or stufentyp = 'systemaktion');

comment on column prozessstufe.systemaktion is
  'Nur bei stufentyp = systemaktion: welche Vorlage an wen geht, wenn die '
  'Stufe erreicht wird. Ausgefuehrt von der Engine ueber das Ausgangsbuch; '
  'die Stufe gilt danach als erledigt und der Lauf rueckt selbst weiter. '
  'Kein Empfaenger auffindbar: Eintrag im Fehlerkorb, der Lauf laeuft '
  'trotzdem weiter -- ein Ablauf darf nicht an einer Mail haengen.';
