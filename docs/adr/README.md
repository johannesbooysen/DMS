# Architekturentscheidungen

Eine Entscheidung bekommt ein ADR, wenn sie mehrere Module berührt, vom
Konzept abweicht oder später teuer zurückzunehmen wäre. Alles andere gehört
als Kommentar an die betroffene Stelle.

Aufbau: Kontext, Optionen, Entscheidung, Konsequenzen. Der Wert liegt in den
Optionen und den Konsequenzen — wer nur die Entscheidung festhält, hat eine
Notiz geschrieben, kein ADR.

Dateiname `NNNN-kurzer-titel.md`, fortlaufend nummeriert. Ein ADR wird nicht
umgeschrieben, wenn es überholt ist; es bekommt den Stand `abgelöst` und
verweist auf den Nachfolger.

| Nr. | Entscheidung | Stand |
|---|---|---|
| [0001](0001-pdf-bibliothek.md) | PDF-Bibliothek: pdfjs-dist statt pdfium | angenommen |
| [0002](0002-workflow-modell.md) | Workflow-Modell: Kette oder Graph, Bedingungen, Delegation | **vorgeschlagen** |

> Dieses Verzeichnis wird von `npm run docs:check` geprüft: Jedes ADR im
> Ordner muss hier stehen.
