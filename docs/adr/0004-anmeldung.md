# ADR 0004 — Anmeldung über Entra ID, Sitzung in Postgres

**Status:** angenommen (2026-08-31)
**Betrifft:** `supabase/migrations/20260831180000_anmeldung.sql`, `src/anmeldung/`, `src/app/lib/sitzung.ts`

## Ausgangslage

Das Konzept sagt zur Anmeldung **nichts**. Kein Wort zu Passwort, Single
Sign-on oder Zwei-Faktor. Bis hierher stand an ihrer Stelle die
Umgebungsvariable `DMS_BENUTZER` — ausdrücklich keine Authentifizierung: Wer
den Prozess starten konnte, war, wen er behauptete zu sein.

Die RLS trug trotzdem von Anfang an. Es fehlte nur die Brücke von einer
echten Sitzung zu `app.mein_benutzer()`. Ohne sie ist jede Rechteprüfung im
System eine Übung ohne Gegenstand.

Zwei Fragen sind zu entscheiden, und nur die erste ist teuer zu drehen.

## Entscheidung 1: Wer bestätigt die Identität?

**Microsoft Entra ID über OpenID Connect.** Das DMS kennt kein eigenes
Passwort.

Erwogen und verworfen:

**Eigenes Passwort im DMS.** Läuft sofort, ohne Fremdsystem, ohne
App-Registrierung. Dafür trägt das DMS dauerhaft: Speicherung mit Argon2id,
Zurücksetzen per E-Mail, Sperre nach Fehlversuchen, Zwei-Faktor, und die
Frage, was bei einem Austritt passiert. Das ist keine einmalige Arbeit,
sondern eine dauerhafte — und jeder dieser Punkte ist in Microsoft 365
bereits gelöst und wird dort ohnehin gepflegt.

**Supabase Auth.** Läge nahe, weil die Datenbank ohnehin Supabase ist. Bindet
aber die Anmeldung an einen Anbieter, dessen übrige Dienste das Projekt nicht
benutzt — Migrationen sind handgeschriebenes DDL, die Queue ist pg-boss in
derselben Datenbank. Und es widerspricht dem Ziel, dieselbe Codebasis als
Modul einer Verwaltungssoftware zu betreiben: Dort bringt die Wirtsanwendung
die Anmeldung mit.

Der Ausschlag gibt der Austritt eines Mitarbeiters. Bei Entra ID ist ein
gesperrtes Konto überall gesperrt, auch im DMS. Bei einem eigenen Passwort
ist es ein zusätzlicher Schritt, an den jemand denken muss.

**Auflage:** Der Anbieter steht hinter einem Interface
(`Identitaetsanbieter`), wie der KI-Anbieter. Ein zweiter Anbieter — oder die
Wirtsanwendung im Modulbetrieb — kostet dann eine Datei, nicht einen Umbau.

## Entscheidung 2: Woran hängt die laufende Sitzung?

**Serverseitige Sitzung in Postgres, im Cookie nur ein Zufallswert.** Kein
selbsttragendes Token (JWT).

Ein JWT im Cookie wäre bequem: keine Datenbankabfrage je Aufruf, keine
Tabelle, kein Aufräumen. Der Preis ist, dass es bis zum Ablauf gilt — egal,
was inzwischen geschehen ist. Genau das ist im DMS nicht hinnehmbar:

* Wird jemandem eine Rolle entzogen, gilt sie im Token weiter.
* Wird ein Mitarbeiter gesperrt, arbeitet er bis zum Ablauf weiter.
* Eine Abmeldung ist eine Bitte, kein Vorgang.

Bei zwölf Stunden Gültigkeit heißt das im schlechtesten Fall zwölf Stunden
Weiterarbeit nach der Sperrung. Die Datenbankabfrage je Aufruf ist dagegen
ein Index-Zugriff auf eine kleine Tabelle.

`app.sitzung_aufloesen` prüft Ablauf, Untätigkeit und Sperrung **bei jedem
Auflösen** und beendet die Sitzung dabei — nicht erst in einem nächtlichen
Aufräumlauf. Eine übergangene, aber offene Sitzung ließe sich sonst mit einem
mitgeschnittenen Token später weiterbenutzen.

## Folgen

**Wer im DMS arbeiten darf, entscheidet die Verwaltung, nicht Microsoft.**
`app.identitaet_aufloesen` legt bewusst **keinen** Benutzer an. Eine gültige
Anmeldung ohne angelegten Benutzer endet mit einem Hinweis, nicht mit einem
Zugang. Ohne diese Trennung hätte jeder im Microsoft-Mandanten mit dem ersten
Anmeldeversuch Zugriff, und die Rechtevergabe liefe der Anmeldung hinterher.

Die Verknüpfung entsteht beim ersten Mal über die E-Mail-Adresse; danach über
den Claim `oid`. Nicht über `sub` (bei Entra anwendungsbezogen, wechselt mit
der App-Registrierung) und nicht dauerhaft über die E-Mail (ändert sich bei
Namenswechsel).

**Die Anwendung ist ohne Einrichtung nicht startbar** — und das ist Absicht.
Fehlen die Entra-Variablen, bricht `anbieter()` mit einer Meldung ab, die
sagt, was fehlt. Es gibt keinen stillen Rückfall auf die
Entwicklungsanmeldung: Die verlangt `DMS_ANMELDUNG=entwicklung` **und**
`NODE_ENV != production`. Eine Umgebungsvariable wandert beim Kopieren einer
Konfiguration mit; zwei unabhängige Bedingungen decken dieses Versehen ab.

**`angemeldeterBenutzer()` ist jetzt `async`.** Das ist die ehrliche Form:
Wer angemeldet ist, steht erst nach einer Abfrage fest, und die Sitzung kann
seit dem letzten Aufruf widerrufen worden sein.

**Ausdrücklich nicht gespeichert:** IP-Adresse und Browserkennung. Beides
wäre personenbezogen und bräuchte Aufbewahrungsfrist und Begründung; für die
Funktion der Sitzung wird es nicht gebraucht. Missbrauchserkennung ist eine
eigene Entscheidung mit eigener Begründung, kein Nebeneffekt.

## Was aussteht

* **Die App-Registrierung in Entra** kann nur jemand mit Adminrechten im
  Microsoft-Mandanten anlegen. Bis dahin läuft nur die Entwicklungsanmeldung.
* **Abgelaufene Sitzungen aufräumen.** Sie sind wirkungslos, wachsen aber.
  Ein pg-boss-Auftrag wäre der naheliegende Ort.
* **Sitzungen im Betrieb widerrufen.** `app.sitzungen_widerrufen` steht und
  ist getestet, aber keine Maske ruft sie auf. Nötig, sobald es eine
  Benutzerverwaltung gibt — spätestens beim ersten verlorenen Notebook.
* **Einzelabmeldung bei Entra** (RP-initiated logout). Derzeit endet nur die
  DMS-Sitzung; die Microsoft-Sitzung im Browser bleibt bestehen. Auf einem
  gemeinsam genutzten Rechner ist das ein Unterschied.
