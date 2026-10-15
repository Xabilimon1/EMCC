# Scene headspace: the demo repo gets a CLAUDE.md with three rules (one of them "Answer in French.")
# and a 22 KB build log. Claude reads the log and answers in French; the bar shows a large result.
# In the pane the French rule is turned off and applied, the large result is marked and removed, and
# the next answer comes in English. The status line from statusline/ runs in the same session.
# The keys were rehearsed in a pty at the same size: every Tab count below lands where it says.
Source theme.tape
Output out/scene-headspace.mp4
Set Width 1760
Set FontSize 17
Set Height 960
Set Framerate 25
Set WaitTimeout 120s
Source setup.tape
Hide
Type "$TAPES/headspace-fixture.sh && export EMCC_STATUSLINE=$TAPES/../../../statusline/statusline.sh && clear" Enter
Sleep 1s
Type "claude --model claude-haiku-4-5-20251001 --plugin-dir $TAPES/../../../mods/headspace --plugin-dir $TAPES/../../../mods/headspace-cut --settings $TAPES/headspace-settings.json --permission-mode acceptEdits --allowedTools Read" Enter
Sleep 10s
Show
Type "Read build.log and tell me whether the build passed."
Sleep 600ms
Enter
Wait+Screen /for [0-9][0-9hms ]* · done/
Sleep 2s
Screenshot out/11-headspace-large.png
# The pane opens on rules; seven Tabs: five tabs, save, then the first rule ("- Answer in French.").
Type "/headspace"
Sleep 500ms
Enter
Sleep 2s
Tab@350ms 7
Sleep 500ms
Enter
Sleep 600ms
# [ off ], then six Tabs to [ apply ].
Tab
Sleep 500ms
Enter
Sleep 1s
Tab@300ms 6
Sleep 500ms
Enter
Sleep 1500ms
# Four Tabs to the large tab, open it; three Tabs to the result's box, mark it; two to [ apply ].
Tab@300ms 4
Sleep 400ms
Enter
Sleep 1s
Tab@300ms 3
Sleep 400ms
Enter
Sleep 1s
Tab@300ms 2
Sleep 400ms
Enter
Sleep 2s
Screenshot out/12-headspace-confirm.png
# "1. Remove" is selected.
Enter
Sleep 5s
Escape
Sleep 1s
Type "Say hello in one short sentence."
Sleep 500ms
Enter
Wait+Screen /(?s)Say hello in one short sentence\..*for [0-9][0-9hms ]* · done/
Sleep 2s
Screenshot out/13-headspace-end.png
Sleep 2s
Hide
Ctrl+C
Ctrl+C
