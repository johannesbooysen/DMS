# INTEGRATION.md — DMS → RealesOS

> Übergabe-Manifest nach `CLAUDE.md` § 12. Laufend pflegen. Was hier nicht steht, wird bei der Integration nicht übernommen.

## 1. Snapshot-Stand
- RealesOS-Commit: `9b37d25e` (Stand 2026-10-06), Details in `realesos-snapshot/SNAPSHOT.md`

## 2. Migrationen
| Datei | Zweck | Risikoklasse | Rollback |
|---|---|---|---|
| `20261006120000_create_dms_schema.sql` | Schema `dms`, Grundrechte, `dms.events`, `dms.log_event()`, Bucket `dms-files` | M | `20261006120000_rollback_create_dms_schema.sql` |

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
| E-2 | Lieferanten führend in `persons` oder `business_partners` | offen |
| E-3 | KI-Auslese ja/nein | offen |
| E-4 | Externe Rollen im Portal | nein (vorläufig) |
| E-5 | Schnittstelle Kostenbuchung | offen, siehe S-1 |
| E-6 | UI-Name und Routenpräfix | offen |
| E-7 | E-Mail-Eingang: Adresse je Mandant, Mail-Dienst | offen |

## 14. Abweichungen von CLAUDE.md
| Abweichung | Begründung | Freigabe |
|---|---|---|
| — | | |
