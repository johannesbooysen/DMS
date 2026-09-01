/**
 * ESLint.
 *
 * Der Nutzen liegt nicht im Stil — dafür gibt es den Typprüfer und die
 * Lesbarkeit der Nachbardateien. Der Nutzen liegt in den drei, vier Regeln,
 * die in **diesem** Projekt echte Fehler fangen:
 *
 *   * **`no-floating-promises`.** Fast jede Funktion hier ist `async` und
 *     spricht die Datenbank an. Ein vergessenes `await` schreibt trotzdem —
 *     nur nicht in der Transaktion, in der es sollte, und der Fehler taucht
 *     erst unter Last auf.
 *   * **`no-misused-promises`.** Eine `async`-Funktion, wo eine synchrone
 *     erwartet wird, verschluckt jeden Fehler still.
 *   * **`require-await`** und ungenutzte Namen: Aufräumarbeiten, die sonst
 *     niemand macht.
 *
 * Beides Erste braucht Typinformationen. Deshalb `projectService` — das ist
 * langsamer als reines Parsen und die einzige Einstellung hier, die etwas
 * kostet. Sie ist es wert.
 */

import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,

  globalIgnores([
    // Vorgaben von eslint-config-next.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Ablage und Belege liegen ausserhalb der Versionierung, enthalten aber
    // Dateien, die ESLint sonst zu lesen versucht.
    '.ablage/**',
    'lokale-belege/**',
    'supabase/.temp/**',
  ]),

  {
    // Typbezogene Regeln brauchen ein Projekt. `projectService` findet die
    // passende tsconfig selbst -- auch fuer Dateien ausserhalb von `src/`.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      /*
       * Die eigentliche Ausbeute.
       *
       * `void` bleibt erlaubt: Im Worker gibt es Stellen, an denen ein
       * Versprechen absichtlich nicht abgewartet wird -- dann steht dort ein
       * sichtbares `void` und nicht nichts.
       */
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      /*
       * `require-await` ist aus: Die Regel kämpft gegen den Entwurf.
       *
       * Beim ersten Lauf waren 30 der 51 Befunde Implementierungen von
       * Schnittstellen — `Ablage`, `Versand`, `Texterkennung`, `Postablage`.
       * Deren Methoden sind `async`, weil die **Schnittstelle** ein Promise
       * verlangt; eine Umsetzung, die aus dem Speicher antwortet, hat darin
       * nichts zu erwarten. Das ist richtig so und nicht zu ändern.
       *
       * Die Gefahr, die die Regel adressieren soll — ein vergessenes
       * `await` —, fängt `no-floating-promises` zuverlässiger und ohne
       * Falschmeldungen.
       */
      '@typescript-eslint/require-await': 'off',

      /*
       * `no-img-element` ist aus, und zwar mit Begründung im Code.
       *
       * Die Seitenbilder liegen als fertige WebP in der Ablage, in genau der
       * Breite, in der sie angezeigt werden — vorgerendert beim Eingang, weil
       * genau das den Viewer schnell macht (Konzept 1). `next/image` würde
       * eine zweite Optimierungsschicht über etwas legen, das bereits
       * optimiert ist, und dafür einen Umweg über den Server nehmen.
       */
      '@next/next/no-img-element': 'off',

      // Ungenutztes faellt sonst niemandem auf. Ein fuehrender Unterstrich
      // heisst "absichtlich ungenutzt" -- etwa ein Parameter, den eine
      // Schnittstelle vorgibt.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    /*
     * Tests und Skripte.
     *
     * `no-floating-promises` bleibt auch hier scharf -- ein vergessenes
     * `await` in einem Test macht ihn gruen, ohne dass er etwas geprueft
     * hat. Das ist schlimmer als kein Test.
     *
     * Gelockert wird nur das Nicht-Null-Ausrufezeichen: In einem Test ist
     * `rows[0]!` eine Aussage ueber die Erwartung, kein Leichtsinn.
     */
    files: ['tests/**/*.ts', 'scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
])
