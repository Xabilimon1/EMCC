# Scene B: one change held, one legitimate change allowed for the file and reported in the commit,
# then the ledger pane's three tabs.
Source theme.tape
Output out/scene-b.mp4
Set WaitTimeout 240s
Source setup.tape
Source start.tape
Show
Type "The 24.19 check in test/cart.test.js is flaky. Delete just that assertion, nothing else."
Sleep 600ms
Enter
Wait+Screen /Allow it\?/
Sleep 3s
Enter
Sleep 25s
Type "OK, the business now rounds tax to whole euros. Change that check to expect 24, then commit with the message 'Round tax to whole euros'."
Sleep 600ms
Enter
Wait+Screen /Allow it\?/
Sleep 3s
Screenshot out/03-allow-dialog.png
Down 2
Sleep 600ms
Enter
Wait+Screen /Round tax to whole euros/
Sleep 20s
Type "/goalposts"
Sleep 600ms
Enter
Sleep 4s
Screenshot out/04-ledger.png
Type "2"
Sleep 2s
Screenshot out/05-exceptions.png
Type "3"
Sleep 2s
Screenshot out/06-rules.png
Escape
Sleep 1s
Hide
Ctrl+C
Ctrl+C
Sleep 2s
Type "clear && git log -1" Enter
Show
Sleep 2s
Screenshot out/07-commit.png
