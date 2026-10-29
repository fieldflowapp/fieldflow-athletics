# FieldFlow Athletics NEO (build 45)

NEO applies the approved Neon Athletics identity to the existing app. The landing
page retains its three workspaces and official logo. Class/Track uses magenta,
Competition/Field uses amber and orange, and Athlete Database uses purple.

`assets/neo.css` is a shared, screen-only theme. `assets/neo-home.css` contains the
landing page layout. Inter and Montserrat are served locally with their OFL
licenses. Existing controls, routes, IDs, handlers, results and data services are
retained. The comparison chart changes only its display palette.

On mobile, competition and field filters occupy two columns. Additional student
tools and event status are available under a native disclosure. Navigation scrolls
within its own row, and the start page fits small portrait and landscape screens.
Selected clear, miss, pass and attendance states remain visually distinct.

## Preserved boundaries

- No edits to `photo-finish/`, its integration scripts, camera or return behavior.
- No SQL, API, authentication, sporting-rule, scoring or stored-result changes.
- NEO styles load only on their listed pages and cannot cascade into the Photo
  Finish iframe. Existing printable documents retain their print styles.
- The PWA retains its identity, start route and scope. Build metadata advances to
  45, while minimum supported version stays 31 to avoid interrupting existing
  recording sessions.

## Validation

- `node --test tests/class-logic.test.cjs tests/compare-logic.test.cjs`: 18 tests.
- `node tests/class-browser.cjs`: desktop/mobile sessions, attendance, attempts,
  failed saves, stable series, relays, high jump, histories, PDF pagination and
  Photo Finish round-trip; includes selected-state visual checks.
- `node tests/compare-browser.cjs`: desktop/mobile filters, source/condition
  separation, rankings, ties, selections and chart interaction.
- Additional local browser review covers eight remaining modules in desktop and
  mobile, and compares three printed layouts with the stable version.

Browser tests accept `FF_TEST_BROWSER_EXECUTABLE` for an installed browser and
`FF_TEST_OUTPUT_DIR` for screenshots. Defaults retain the existing CI behavior.
PRs run verification without deploying. Publishing remains the main-branch Pages
workflow; revert this release commit to restore the previous appearance.

Desktop Chrome and an emulated mobile viewport are covered by local validation.
Physical iOS/Android, outdoor readability and camera hardware still require device
review. Generated mockups are visual references, not additional implemented
features.
