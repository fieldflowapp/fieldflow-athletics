# Class Mode: students, lanes and automatic series (build 48)

Track sessions, including sprints and 400 m, now use the selected students, actual
available lanes (1-8), and mixed or separate Female/Male grouping. No manual
series count is required. Full series come first; a final singleton borrows one
runner from the preceding series where possible (17 runners / 8 lanes = 8, 7, 2).
The visible **Next round** button creates a new independent round using the
current choices. Existing marks, earlier rounds and Photo Finish entry IDs remain
unchanged. A round's lane selection is stored and restored when the event reopens.

Saving attendance also adds newly available runners to the current managed round.
They join the last matching pending series. A new series borrows a companion only
from an unrecorded series with at least three runners, preserving entry IDs. A
completed series or one containing any recorded status is never rearranged.
When a companion is impossible because of saved results, one lane, an odd count
with two lanes, or a single participant of one sex, the app reports the constraint
rather than exceeding lane capacity or moving saved results. Next round recalculates
the groups. Legacy rounds remain untouched until a managed next round is created.

Relays retain named teams, event-specific leg counts, leg order and team times.
Each complete team occupies one lane. Initial series and lane assignments are
calculated automatically; late teams append to the last pending series. A new
series may borrow an unrecorded complete team. Recorded series and memberships
stay locked. **Next round** copies complete teams whose members are all available;
it does not split teams or convert team times into individual splits. Relay
activities retain the existing Female/Male eligibility rules.

The database update is additive: admin-only, RLS-protected round settings plus
nullable lane/series metadata on relay teams. All new RPCs are SECURITY INVOKER
and reject anonymous calls. Existing generation RPCs remain compatible for older
clients. No code inside `photo-finish/` changes.

Validation:

- 23 logic tests, including exhaustive capacity/count invariants, selected lanes,
  mixed/gender grouping, existing marks and comparison behavior.
- Real database tests in `tests/class-series-database.sql` run within a transaction
  and roll back every fixture. They cover 8+7+2, 7+2 late pairing, saved-series
  locks, retries, unauthorized users, full relay teams, departed recorded members,
  late teams, and new rounds with nonconsecutive lanes.
- Desktop/mobile browser suite covers the actual selection, preview, Next round,
  late attendance, complete relay round copying, existing forms, and Photo Finish
  return. Existing comparison and print checks remain in place.
- Supabase security advisories were compared before and after; no new findings.
