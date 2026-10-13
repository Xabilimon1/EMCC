# Scene C: /goalposts audit over a branch that already lowered the bar.
Source theme.tape
Output out/scene-c.mp4
Set WaitTimeout 120s
Source setup.tape
Type "git checkout -q shortcuts && clear" Enter
Source start.tape
Show
Type "/goalposts audit main"
Sleep 600ms
Enter
Wait+Screen /lower the bar since main/
Sleep 3s
Screenshot out/08-audit.png
Hide
Ctrl+C
Ctrl+C
Sleep 1s
Type "git checkout -q main" Enter
