# 800 m open starts (build 50)

Class Mode now respects an open 800 m start: all selected runners share one series
in mixed mode, or one series per sex in separate Female/Male mode. The lane count,
individual lane picker and lane-assignment editor are hidden. There is no eight
runner limit. 400 m and other lane-based events retain their current capacity and
actual lane selections.

New 800 m rounds store `start_mode = mass_start` and actual NULL lane values, rather
than treating runner numbers as physical lanes. The existing Photo Finish UI
already supports unassigned runners and requires no edits. Times still save and
verify by stable entry ID. Late arrivals join the last pending matching open
series without a lane; recorded or completed series remain protected.

Existing rounds and saved marks are retained. In a session containing older
lane-based 800 m rounds, **Next round** creates a new open series for the selected
students. The new nullable lane column is guarded: lane-based events still require
a lane, while new open rounds reject physical lane assignments. RLS and existing
administrator checks remain in force.

Validation covers 20 runners plus a late arrival in a single open start, separated
sex groups, preservation of historical lane-based rounds and times, 400 m capacity,
and relay compatibility. Database fixtures roll back. The desktop/mobile browser
suite exercises 18 open-start runners, hidden lane controls, runner labels in the
unchanged Photo Finish interface, a verified save/return and Next round.
