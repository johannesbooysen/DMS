# INTEGRATION.md — DMS → RealesOS

> Übergabe-Manifest nach `CLAUDE.md` § 12. Laufend pflegen. Was hier nicht steht, wird bei der Integration nicht übernommen.

## 1. Snapshot-Stand
- RealesOS-Commit: `9b37d25e` (Stand 2026-10-06), Details in `realesos-snapshot/SNAPSHOT.md`

## 2. Migrationen
| Datei | Zweck | Risikoklasse | Rollback |
|---|---|---|---|
| `20261006120000_create_dms_schema.sql` | Schema `dms`, Grundrechte, `dms.events`, `dms.log_event()`, Bucket `dms-files` | M | `20261006120000_rollback_create_dms_schema.sql` |
| 69 DMS-Migrationen `20260828100000` bis `20261002100000` | Das fachliche Schema des DMS (Tabellen, Policies, Funktionen, Trigger) — Liste mit Tabellen in [docs/stand.md](../stand.md); wird für die Einbindung zu **einer** Grundmigration aus dem Zielschema zusammengefasst (Vorschrift § 5.2) | L | Neuaufbau |
| `20261006130000_schutz_pruefen_dms.sql` | Schutzprüfung nur für DMS-Tabellen; entzieht `dms_app` die Rechte auf den 28 RealesOS-Tabellen | M | Rechte neu vergeben (nicht vorgesehen) |
| `20261006140000_schema_dms.sql` | Umzug aller DMS-Tabellen und -Funktionen nach `dms` an Ort und Stelle (OIDs bleiben), Funktionstexte neu geschrieben, Schema `app` entfernt | L | nur per Neuaufbau |
| `20261006150000_ablagen.sql` | Tabelle `dms.ablage` (Lesen Mandant, Schreiben `stammdaten_pflegen`), `dokument.ablage_id` (not null, Trigger-Vorgabe über `dms.ablage_fuer`), `rolle_recht.ablage_id`, `dms.meine_ablagen()`, `dms.darf_in_ablage()`; Policy `dokument_lesen` um die Ablage erweitert | M | Spalten und Funktionen entfernen, Policy aus 20260831210000 wiederherstellen |

## 3. Tabellen und Löschregeln
| Tabelle | `tenant_id` | weitere Fremdschlüssel | Begründung |
|---|---|---|---|
| `dms.events` | `RESTRICT` | — (`actor_id` bewusst ohne FK) | § 147 AO, unveränderbar |

## 4. Storage
| Bucket | öffentlich | Größengrenze | MIME-Typen | Policies |
|---|---|---|---|---|
| `dms-files` | nein | 25 MB | PDF, XML, JPEG, PNG, TIFF, `message/rfc822` | SELECT eigener Mandant; INSERT admin/mitarbeiter; kein UPDATE/DELETE |

## 5. Edge Functions
| Name | `verify_jwt` | Secrets (nur Namen) | Zweck |
|---|---|---|---|
| — | | | |

## 6. API-Konfiguration
- [ ] Schema `dms` in `[api] schemas` freigeben (`vorlagen/supabase/config.toml.snippet`) und in den Projekteinstellungen

## 7. Rechte-Schlüssel
| Schlüssel | Bedeutung | admin | mitarbeiter |
|---|---|---|---|
| `VIEW_INBOX` | Posteingang ansehen | ✓ | ✓ |
| `MANAGE_INBOX` | Eingänge zuordnen, bearbeiten | ✓ | ✓ |
| `APPROVE_INCOMING_INVOICES` | Rechnungen freigeben | ✓ | — |

Feiner als die drei Schlüssel: Das DMS vergibt Rechte je **Rolle**, wahlweise begrenzt auf eine **Ablage** (`rolle_recht.ablage_id`, Migration 20261006150000). Für die Einbindung werden die drei Schlüssel auf Rollen des DMS abgebildet; die Ablagenrechte bleiben Sache des DMS (E-8, offen).

## 8. Registry, Routen, Katalog
- Registry-Eintrag: siehe `CLAUDE.md` § 10.2 — `parentId`: offen (E-1)
- Routen: `/dms`, `/dms/:id` (vorläufig, E-6)
- `saas_modules`: `key = 'dms'`, `category` und `parent_module_id` offen (E-1)

## 9. Neue Icons
| Lucide-Name | Material-Symbol |
|---|---|
| — | — |

## 10. Neue Abhängigkeiten
| Paket | Version | Zweck | Warum nicht vorhanden | Freigabe |
|---|---|---|---|---|
| — | | | | |

## 11. Glossar-Vorschläge
| Begriff | Bedeutung | Verwendung in UI |
|---|---|---|
| Posteingang | Bereich für eingehende Fremddokumente | „Posteingang" |
| Eingang | Ein einzelnes eingegangenes Dokument (Brief, E-Mail, Rechnung) — nicht „Vorgang" | „Eingang" |

## 12. Schnittstellenwünsche an RealesOS
| # | Was | Warum | Gewünschte Signatur | Auswirkung | Dringlichkeit |
|---|---|---|---|---|---|
| S-1 | Kostenbuchung aus freigegebener Rechnung | E-5 | RPC, z. B. `public.create_cost_entry_from_dms(p_invoice_id uuid) → uuid` | schreibt `public.cost_entries` | mittel |
| S-2 | Lösch-Wächter auf `public.tenants` und Erweiterung `delete_tenant_completely()` um `dms.*` | § 5.5 | Trigger nach Vorbild `prevent_tenant_delete_with_commission_history` | Mandantenlöschung | vor Go-live |

## 13. Offene Entscheidungen
| # | Frage | Stand |
|---|---|---|
| E-1 | Untermodul unter `verwaltung` oder Add-on | offen |
| E-2 | Lieferanten führend in `persons` oder `business_partners` | **entschieden 06.10.2026: `business_partners`**; IBAN und USt-IdNr. hält das DMS (`kreditor_bankverbindung`) |
| E-3 | KI-Auslese ja/nein | offen |
| E-4 | Externe Rollen im Portal | nein (vorläufig) |
| E-5 | Schnittstelle Kostenbuchung | offen, siehe S-1 |
| E-6 | UI-Name und Routenpräfix | offen |
| E-7 | E-Mail-Eingang: Adresse je Mandant, Mail-Dienst | offen |
| E-8 | Rechte je Ablage: im DMS (`rolle_recht.ablage_id`) oder als weitere Rechte-Schlüssel in RealesOS | offen; vorläufig im DMS |

## 14. Abweichungen von CLAUDE.md
| Abweichung | Begründung | Freigabe |
|---|---|---|
| Oberfläche in Next.js (Server-Komponenten) statt React-SPA mit RealesOS-Bausteinen; eigener Dienst mit Anmeldung über das Supabase-Token | Übergang (ADR 0010, Weg B): Die Datenbank folgt der Vorschrift, die Oberfläche wird danach Seite für Seite portiert | Eigentümer, 06.10.2026 |
| Eigener Worker-Prozess (Node) für OCR, Rendern, Extraktion, Barcode, Warteschlange (pg-boss), Mailversand, Objektsperre | Minutenlange CPU-Arbeit passt in keine Edge Function; läuft als eigener Container | Eigentümer, 06.10.2026 |
| S3-kompatibler Objektspeicher mit Object Lock (Compliance) statt Bucket `dms-files` | GoBD-Unveränderbarkeit der Originale (ADR 0006); Supabase Storage kennt keine Objektsperre | Eigentümer, 06.10.2026 |
| Pakete: pg-boss, tesseract.js, sharp, zxing-wasm (Worker), embedded-postgres (nur Entwicklung) | nur im Worker beziehungsweise lokal; nichts davon gelangt in die RealesOS-Webanwendung | Eigentümer, 06.10.2026 |
| Deutsche Bezeichner für Tabellen, Spalten, Funktionen und Code; `mandant_id` statt `tenant_id` (zeigt auf `public.tenants`) | durchgängige Konvention des DMS, Umbenennung ohne fachlichen Gewinn | Eigentümer, 06.10.2026 |
| Geld als `numeric` statt `BIGINT` in Cent | Summenzwang und Kontierung rechnen in Euro mit zwei Nachkommastellen; Umstellung berührt Hash-Bildung | Eigentümer, 06.10.2026 |
| Zeilenrechte über `dms.mein_mandant()` / `dms.meine_objekte()` statt `public.get_user_tenant_id((select auth.uid()))` | Der Next-Server verbindet ohne JWT und setzt die Sitzung je Transaktion; `mein_mandant()` schließt `auth.uid()` ein; Objektsichtbarkeit ist feiner als Mandant | Eigentümer, 06.10.2026 |
