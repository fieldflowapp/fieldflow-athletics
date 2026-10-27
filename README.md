# FieldFlow Athletics

Independent FieldFlow Athletics admin PWA.

## Admin modules
- Track
- Field
- Relays
- Photo Finish
- Print
- Class Mode (Craighouse only): mixed-gender sessions, repeated attempts and manual marks
- Craighouse Athlete Database: individual history, progress and filtered best marks

## Craighouse Class Mode
Open `craighouse/` using an existing Athletics administrator account. All Genders is
the default for new sessions. Session/attempt/athlete identifies each result, so
retrying a save updates that result while the next attempt retains previous marks.
Saves are atomic and verified with a subsequent read. Blank new rows are ignored.
The first version uses manual entry; Photo Finish continues to serve official heats.

`database/craighouse-class-mode.sql` documents the additive production migration.
Class data uses separate RLS-protected tables. The history view reads official
track, field, high jump and relay results live without copying or modifying them.
Relay history is explicitly a team time. Dates use scheduled heat dates when
available, otherwise original recording dates. Rankings separate category, gender
and equipment/conditions; database bests do not certify school records.

Validation: `node --test tests/class-logic.test.cjs`; browser suite
`node tests/class-browser.cjs` with Playwright installed; rollback-only database
checks in `tests/class-database.sql`. The deployment workflow runs desktop/mobile
browser tests before publishing.

## Architecture
This repository is intentionally independent from other FieldFlow sports apps. Each sport should live in its own repository and PWA scope.

Public results/schedule/bases will be added later as a separate public-facing surface.

Deployment status: GitHub Pages enabled.
