# Shared start: a clean shell in the demo repo (EMCC_DEMO, or ~/Developer/emcc-demo), without
# the markers of any Claude session that launched vhs, then Claude Code with only the EMCC mods.
# Every take runs in a Claude config of its own (EMCC_CLAUDE_CONFIG, default ~/.claude-emcc-recording,
# logged in once with /login): no personal CLAUDE.md, memory or plugins in the recording, and
# nothing the session does is written into ~/.claude.
Hide
Type "export TAPES=$PWD DEMO=${EMCC_DEMO:-$HOME/Developer/emcc-demo} CLAUDE_CONFIG_DIR=${EMCC_CLAUDE_CONFIG:-$HOME/.claude-emcc-recording} _ZO_DOCTOR=0 PS1='$ '; unset CLAUDECODE CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_SESSION_ID CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_EXECPATH CLAUDE_CODE_SESSION_ATTENDED CLAUDE_PID CLAUDE_EFFORT CLAUDE_JOB_DIR CLAUDE_CODE_VERSION; cd $DEMO && clear" Enter
Sleep 1s
