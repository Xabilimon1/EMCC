# The mods load from this repo, so what is recorded is what is committed, installed or not.
# Haiku 4.5: Opus fixes the code on its own, so it never shows a guard at work.
Type "claude --model claude-haiku-4-5-20251001 --plugin-dir $TAPES/../../../mods/emcc-core --plugin-dir $TAPES/../../../mods/goalpost-guard --settings $TAPES/demo-settings.json --permission-mode acceptEdits --allowedTools 'Bash(npm test)' 'Bash(git add:*)' 'Bash(git commit:*)'" Enter
Sleep 10s
