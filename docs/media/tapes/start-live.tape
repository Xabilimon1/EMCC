# The start for the live scene: the same session as start.tape plus witness and headspace. witness
# opens its pane on its own only from 144 columns, so this scene runs wider than the others.
Set Width 1760
Set FontSize 17
Set Height 960
Type "claude --model claude-haiku-4-5-20251001 --plugin-dir $TAPES/../../../mods/emcc-core --plugin-dir $TAPES/../../../mods/goalpost-guard --plugin-dir $TAPES/../../../mods/witness --plugin-dir $TAPES/../../../mods/headspace --plugin-dir $TAPES/../../../mods/headspace-cut --settings $TAPES/demo-settings.json --permission-mode acceptEdits --allowedTools 'Bash(npm test)' 'Bash(git add:*)' 'Bash(git commit:*)'" Enter
Sleep 10s
