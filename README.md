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
Track class sessions now connect each heat to Photo Finish. Select multiple categories, save present students, then generate mixed or gender-separated series. New rounds append results without overwriting earlier rounds. Relays require Male or Female and record a team time by colour for each present member, explicitly labelled as a team result.

`database/craighouse-class-mode.sql` and `database/craighouse-sessions-v2.sql` document the additive production migrations.
Class data uses separate RLS-protected tables. The history view reads official
track, field, high jump and relay results live without copying or modifying them.
Relay history is explicitly a team time. Dates use scheduled heat dates when
available, otherwise original recording dates. Rankings separate category, gender
and equipment/conditions; database bests do not certify school records.

Validation: `node --test tests/class-logic.test.cjs`; browser suite
`node tests/class-browser.cjs` with Playwright installed; rollback-only database
checks in `tests/class-database.sql` and `tests/class-v2-database.sql`. The deployment workflow runs desktop/mobile
browser tests before publishing.

## Architecture
This repository is intentionally independent from other FieldFlow sports apps. Each sport should live in its own repository and PWA scope.

Public results/schedule/bases will be added later as a separate public-facing surface.

Deployment status: GitHub Pages enabled.

### Class Mode v34 — complete class sessions

A saved class can contain several activities with independent attendance for each activity. The first activity retains the original session ID; additional activities use `parent_session_id`. Existing marks and official result identities are preserved. The UI shows one session with an activity selector.

Attendance distinguishes historical participation (`present`) from current availability (`available`). Late arrivals and departures apply only to the selected activity; departing students keep all results and are excluded from that activity’s future heat generation. Teachers select the participants for each new track round. Lane/series edits are atomic and only allowed before either affected heat has results; Photo Finish keeps stable entry IDs.

Mark-level conditions snapshot timing method, implement weight and free-text conditions. Defaults affect new marks; corrections retain original conditions unless explicitly edited. Manual and Photo Finish marks are separated in comparison groups. An append-only correction log records old/new values, teacher identity and time. The only privileged writer is a private, non-callable audit trigger; all normal RPCs use invoker permissions and administrator RLS.

Relays have named teams and ordered members for each attempt, restricted to the activity's Male/Female setting. Saved membership is locked; later attempts can use different teams. Team times are recorded in each member's history with team/leg labels and are never treated as individual splits. Legacy colour-based relay marks remain visible.

The session summary includes attendance per activity, result counts, missing results, comparable best marks and corrections. Closing a session protects all its activities; teachers can explicitly reopen it. Official competition scoring is unchanged.

Apply `database/craighouse-sessions-v3.sql` after v1 and v2. Validate with `tests/class-v3-database.sql` (transaction rollback), `node --test tests/class-logic.test.cjs`, and `node tests/class-browser.cjs`. Browser tests use mock transport on desktop/mobile and cover actual navigation to/from the class Photo Finish page; camera hardware requires device testing.

### v35 — attendance owned by each event

Each additional activity starts with `attendance_recorded=false` and an empty list. Its teacher must save attendance before results or heats can be recorded. Saving attendance only updates that activity, including the root/first event; it never propagates to siblings. Existing recorded attendance and marks are retained. Gender, colour and name/ID filters combine; Select/Clear visible only affect matching students and retain hidden selections. Activity switching is available while taking attendance. Apply `database/craighouse-activity-attendance-v35.sql` after v3. The current database/browser tests verify this independent attendance model.
