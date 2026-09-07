# syntax=docker/dockerfile:1

# ===========================================================================
# Ein Image, zwei Prozesse (ADR 0007)
# ===========================================================================
#
# Web und Worker teilen sich denselben Quelltext und unterscheiden sich nur
# im Startbefehl. Zwei Images waeren zwei Staende, die auseinanderlaufen --
# und der Fehler faellt genau dann auf, wenn der Worker eine Tabelle nicht
# kennt, die die Anwendung schon schreibt.
#
# BASIS: DEBIAN, NICHT ALPINE
#
# `@napi-rs/canvas` liefert vorgebaute Binaerdateien gegen glibc. Auf Alpine
# (musl) gaebe es entweder keinen Treffer oder einen Uebersetzungslauf mit
# Rust-Werkzeugkette im Image. Das PDF-Rendern ist kein Randfall dieses
# Systems, sondern der Kern des Geschwindigkeitsversprechens.


# ---------------------------------------------------------------------------
# 1. Abhaengigkeiten (vollstaendig, fuer den Bau)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS abhaengigkeiten
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` und nicht `npm install`: Der Lockfile entscheidet, nicht der Tag
# des Baus. Ein Image, dessen Abhaengigkeiten sich zwischen zwei Baeuen
# aendern, ist nicht dasselbe Image.
RUN npm ci


# ---------------------------------------------------------------------------
# 2. Bau
# ---------------------------------------------------------------------------
FROM abhaengigkeiten AS bau
WORKDIR /app
COPY . .

# Der Bau hat **keine Datenbank**. Alle Seiten, die Daten lesen, sind
# `force-dynamic`; wer eine neue Seite ohne diese Angabe anlegt, bricht den
# Bau hier und nicht erst im Betrieb.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# `public/` gibt es (noch) nicht -- alle Bilder sind Derivate aus der
# Ablage, kein statisches Beiwerk. Das Verzeichnis trotzdem anlegen, damit
# das COPY unten nicht daran scheitert und eine spaetere Datei dort
# von selbst mitkommt.
RUN mkdir -p /app/public


# ---------------------------------------------------------------------------
# 3. Laufzeit
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS laufzeit
WORKDIR /app

# ocrmypdf und die deutsche Sprachdatei fuer die Texterkennung, dazu
# `postgresql-client-17` fuer `npm run sicherung`.
#
# Die Fassung des Clients muss zur Serverfassung passen -- ein `pg_dump` 15
# gegen einen Server 17 bricht ab. Debian bookworm liefert 15, deshalb das
# PGDG-Verzeichnis. Ohne diesen Schritt scheitert die Sicherung erst dann,
# wenn man sie braucht.
#
# Das kostet Platz (rund 600 MB fuer ocrmypdf mit Ghostscript und Tesseract).
# Das ist der Preis dafuer, dass `DMS_OCR=ocrmypdf` eine Einstellung ist und
# kein zweites Image.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ocrmypdf tesseract-ocr-deu postgresql-client-17 tini; \
    apt-get purge -y curl gnupg; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Welcher Stand hier laeuft. Steht im Lebenszeichen, damit die Frage ohne
# Blick in den Container beantwortbar ist.
ARG DMS_FASSUNG=unbekannt
ENV DMS_FASSUNG=${DMS_FASSUNG}

# Nur die Laufzeitabhaengigkeiten. `tsx` steht deshalb unter `dependencies`
# und nicht unter `devDependencies`: Der Worker fuehrt TypeScript direkt aus,
# weil `@/`-Aliase in neunzehn Modulen unter src/ stehen und `tsc` sie beim
# Emit nicht aufloest (ADR 0007).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=bau /app/.next ./.next
COPY --from=bau /app/public ./public
COPY --from=bau /app/next.config.ts ./next.config.ts
COPY --from=bau /app/tsconfig.json ./tsconfig.json
COPY --from=bau /app/src ./src
COPY --from=bau /app/scripts ./scripts

# Rueckfall-Ablage im Dateisystem. In Produktion gehoert sie nach S3 --
# ohne Objektsperre gibt es keinen Schutz am Speicher vorbei (ADR 0006) --,
# aber ein Verzeichnis, das es nicht gibt, waere ein Fehler beim ersten
# Upload statt einer Warnung beim Start.
RUN mkdir -p /app/.ablage && chown -R node:node /app/.ablage

# **Nicht als root.** Der Prozess nimmt Dateien aus dem Netz entgegen und
# gibt sie an ocrmypdf und pdfjs weiter; das sind die beiden Stellen, an
# denen fremde Bytes auf fremden Code treffen.
USER node

# `tini` als PID 1, damit SIGTERM ankommt: Der Worker faehrt darauf geordnet
# herunter (`queueBeenden`), sonst reisst ein Neustart laufende Auftraege ab.
ENTRYPOINT ["/usr/bin/tini", "--"]

EXPOSE 3000
CMD ["npm", "run", "start"]
