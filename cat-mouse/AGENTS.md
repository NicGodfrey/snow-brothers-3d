# Agent coordination — Cat & Mouse

Lucy (`bc-9a1ae0da-1b80-5fe3-985e-94bc5ea1f3eb`) is tech lead. She may spawn high-level auxiliary agents (`generalPurpose`, `model: inherit`, **local** so they share `/workspace`).

Do **not** `git commit`, `git push`, or open PRs. The parent cloud agent owns git.

## Parallel ownership (do not write outside your tree)

| Agent name | Owns | Must not touch |
|---|---|---|
| `engine-lead` | `src/engine/**`, `tests/engine/**` | `src/game`, `src/content`, `src/ui` |
| `gameplay-lead` | `src/game/**`, `tests/game/**` | `src/engine` internals, `src/content/stages` |
| `content-lead` | `src/content/**`, `tests/content/**` | engine/game implementations |
| `presentation-lead` | `src/ui/**`, `src/style.css`, `index.html`, `src/main.ts` wiring, `public/**` | stage data, engine internals |
| `qa-lead` | `tests/**` gaps, `scripts/linecount.mjs`, playability checklist | rewriting gameplay rules |

Shared contracts live in `src/engine/types.ts`, `src/game/types.ts`, `src/content/schema.ts`. Only lucy may change those after the first draft, or she delegates a single "contract" pass.

## Boot order

1. Lucy writes package.json, tsconfig, vite.config, shared types/schema, and empty folder barrels.
2. Lucy launches the five leads **in one parallel wave**.
3. Leads implement against the contracts. If a contract is wrong, they report to lucy; they do not silently fork types.
4. Lucy integrates, runs `npm test` / `npm run build`, fills gaps, reports line counts.

## Naming

Auxiliary agents must use Task `description` values: `engine-lead`, `gameplay-lead`, `content-lead`, `presentation-lead`, `qa-lead`.
