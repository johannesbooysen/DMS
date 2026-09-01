-- Eine Nachricht gilt als geholt, wenn eines ihrer Teile geholt wurde
--
-- Gefunden von einem Test, und der Fehler waere im Betrieb teuer gewesen:
--
--   Eine Mail mit Anhang wird zu einem Beleg mit der Herkunft
--   `<message-id>#rechnung.pdf` -- Message-Id **und** Anhangsname, damit
--   zwei Rechnungen in einer Mail sich unterscheiden lassen.
--
--   Der IMAP-Teil filtert aber, bevor er die Mail ueberhaupt parst; er kennt
--   nur die Message-Id. Er fragte also nach `<message-id>` und bekam "nein",
--   weil gespeichert `<message-id>#rechnung.pdf` steht. Ergebnis: dieselbe
--   Mail bei jedem Durchgang erneut, jedes Mal ein neuer Beleg -- als
--   Dublette erkannt, aber angelegt.
--
-- Die Regel dagegen ist knapp und passt zur Wirklichkeit: **Wer die Teile
-- einer Nachricht verarbeitet hat, hat die Nachricht verarbeitet.** Also
-- zaehlt auch ein Praefixtreffer.
--
-- Der `#` ist dabei wesentlich. Ohne ihn traefe `<a@x>` auch `<a@x.y>` --
-- und eine fremde Nachricht gaelte als erledigt.

create or replace function app.eingang_schon_geholt(
  p_quelle_id uuid,
  p_herkunft  text
)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1 from eingang_geholt g
     where g.quelle_id = p_quelle_id
       and (g.herkunft = p_herkunft
            -- Praefixtreffer ueber den Primaerschluessel (quelle_id,
            -- herkunft): `like 'x#%'` ohne fuehrendes Platzhalterzeichen
            -- kann den Index benutzen.
            or g.herkunft like p_herkunft || '#%')
  );
$$;

comment on function app.eingang_schon_geholt(uuid, text) is
  'Auch ein Praefixtreffer zaehlt: Eine Mail, deren Anhang als '
  '`<id>#name.pdf` vermerkt ist, gilt unter `<id>` als geholt. Ohne diese '
  'Regel holte der IMAP-Teil dieselbe Nachricht bei jedem Durchgang erneut.';

grant execute on function app.eingang_schon_geholt(uuid, text) to dms_app;
