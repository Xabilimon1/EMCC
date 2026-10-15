# How the screenshots and recordings are made

Every image and video in EMCC's READMEs is a real Claude Code session, recorded from a script with [VHS](https://github.com/charmbracelet/vhs). Nothing is drawn or mocked up, and anyone can record them again.

## Record them again

You need Claude Code, VHS (`brew install vhs`), Node and ffmpeg. The takes run in a Claude config of their own, `~/.claude-emcc-recording` (or `$EMCC_CLAUDE_CONFIG`), signed in once with `CLAUDE_CONFIG_DIR=~/.claude-emcc-recording claude` and `/login`, so no personal memory or plugin shows up in a recording. `record.sh` refuses to run on `~/.claude`. Claude Code still reads the CLAUDE.md of every folder above the demo repo, and for your home folder that is `~/.claude/CLAUDE.md`; the scenes' settings exclude it with `claudeMdExcludes: ["**/.claude/CLAUDE.md"]`.

```sh
docs/media/tapes/make-demo-repo.sh      # builds ~/Developer/emcc-demo (or the path you pass, or $EMCC_DEMO)
docs/media/tapes/record.sh              # scenes a, b, c and live into docs/media/tapes/out/
docs/media/tapes/record.sh a            # one scene
EMCC_TAKES=1 docs/media/tapes/record.sh live   # one take only (VHS is heavy on the CPU)
```

The sessions load the mods from this repo with `--plugin-dir`, so what is recorded is what is committed, whether or not you have the mods installed. They run Haiku 4.5: Opus fixes the failing test properly on its own, so it never shows a guard at work.

A scene is a real model session, so a take can go another way (Haiku may fix the code without trying a shortcut). `record.sh` retries a scene until its last screenshot exists, resets the demo repo before every take, and removes from your goalpost-guard store the exceptions a take saved for the demo repo.

## The scenes

| Tape | What happens | Images |
|---|---|---|
| [`scene-a.tape`](tapes/scene-a.tape) | Told `src/` is frozen, Claude rewrites the test's expected value; goalpost-guard holds it; the answer, typed in the dialog, sends Claude back to fix `src/cart.js` | `demo.gif`, `demo.mp4`, `dialog.png`, `dialog-card.png`, `answer.png`, `fixed.png`, `fixed-card.png` |
| [`scene-b.tape`](tapes/scene-b.tape) | One change held, one allowed for the file and committed with its `Goalpost-Change` trailer, then the ledger's three tabs | `ledger.png`, `exceptions.png`, `rules.png`, `commit.png` |
| [`scene-c.tape`](tapes/scene-c.tape) | `/goalposts audit main` on a branch that already lowered the bar | `audit.png` |
| [`scene-live.tape`](tapes/scene-live.tape) | The same task with emcc-core, goalpost-guard, witness and headspace at 159 columns: Claude makes a task list, witness opens its pane and proves or flags each step, headspace's bar sits above the prompt | `hero/emcc-live.gif`, `hero/emcc-live.mp4` |
| [`scene-headspace.tape`](tapes/scene-headspace.tape) | [`headspace-fixture.sh`](tapes/headspace-fixture.sh) gives the demo repo a CLAUDE.md that says "Answer in French." and a 22 KB build log. Claude reads the log and answers in French; in the pane the rule is turned off and the read taken out; the next answer is in English. The status line from [`statusline/`](../../statusline) runs in the same session | `headspace/demo.gif`, `headspace/demo.mp4`, `statusline/statusline.png` |

The terminal uses Anthropic's palette (`#141413`, `#faf9f5`, `#d97757`, `#6a9bcc`, `#788c5d`; see [`theme.tape`](tapes/theme.tape)) and JetBrains Mono.

## From the raw take to the README

The published images in [`goalpost-guard/`](goalpost-guard) are crops of the screenshots in `tapes/out/`, with a 24 px margin in the terminal's own background:

```sh
ffmpeg -i tapes/out/04-ledger.png -vf "crop=602:350:818:28,pad=iw+48:ih+40:24:20:color=0x141413" goalpost-guard/ledger.png
```

`demo.mp4` is scene A cut before Claude's own commit prompt, held for 2.5 s on the dialog and 3.5 s at the end; `demo.gif` is made from it at 12 fps, 1080 px wide:

```sh
ffmpeg -i tapes/out/scene-a.mp4 -filter_complex "[0:v]trim=0:6.9,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2.5[a];[0:v]trim=6.9:12.1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3.5[b];[a][b]concat=n=2:v=1[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 20 goalpost-guard/demo.mp4
ffmpeg -i goalpost-guard/demo.mp4 -vf "fps=12,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" goalpost-guard/demo.gif
```

`hero/emcc-live.mp4` is the live scene sped up where nothing new happens (typing ×4, exploring ×3) and close to real time where the step is flagged, about 24 s in all; the GIF is 1080 px at 12 fps without dithering:

```sh
ffmpeg -i tapes/out/scene-live.mp4 -filter_complex "[0:v]trim=0:16,setpts=(PTS-STARTPTS)/4[a];[0:v]trim=16:20,setpts=(PTS-STARTPTS)/2[b];[0:v]trim=20:36,setpts=(PTS-STARTPTS)/3[c];[0:v]trim=36:44,setpts=(PTS-STARTPTS)/1.5[d];[0:v]trim=44:50,setpts=(PTS-STARTPTS)/2[e];[0:v]trim=50:53,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1.5[f];[a][b][c][d][e][f]concat=n=6:v=1:a=0,fps=25[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart hero/emcc-live.mp4
ffmpeg -i hero/emcc-live.mp4 -vf "fps=12,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=none:diff_mode=rectangle" hero/emcc-live.gif
```

`headspace/demo.mp4` speeds up the typing and the waits (×2.5 and ×3) and plays the pane at ×1.5, about 25 s; the GIF is made the same way as the cover's. `statusline/statusline.png` is the status line cropped from the scene's last screenshot:

```sh
ffmpeg -i tapes/out/13-headspace-end.png -vf "crop=1290:28:20:880,pad=iw+48:ih+40:24:20:color=0x141413" statusline/statusline.png
```

The pane is driven from the keyboard, so the scene counts Tabs. The counts were found by running the same session in a pseudo-terminal rendered with [pyte](https://github.com/selectel/pyte) and reading which element was in reverse video after each key, which costs no recording.

The cut points depend on the take: find them by looking at the frames (`ffmpeg -i tapes/out/scene-a.mp4 -vf fps=2 frame%03d.png`).

## Logo

[`logo/`](logo) holds EMCC's sentinel. [`make-logo.py`](logo/make-logo.py) draws it pixel by pixel on a 40 x 36 grid, padded to 48 so its body sits in the middle, in Anthropic's palette, with two tones of clay for light and shade, and writes the still `emcc-sentinel.svg` and the frames of the GIF:

```sh
python3 docs/media/logo/make-logo.py /tmp/sentinel
for f in /tmp/sentinel/frames/*.svg; do rsvg-convert -w 192 "$f" -o "${f%.svg}.png"; done
ffmpeg -framerate 10 -i /tmp/sentinel/frames/%03d.png -vf "split[a][b];[a]palettegen=reserve_transparent=1:max_colors=16:stats_mode=full[p];[b][p]paletteuse=alpha_threshold=128:dither=none" -loop 0 docs/media/logo/emcc-sentinel.gif
```

It is EMCC's own figure, not Claude Code's mascot: that one is Anthropic's, and its trademark guidelines ask for approval before any use.

## Icons

[`docs/icons`](../icons) holds EMCC's own line icons: 24 px, 1.75 px strokes in `#d97757`, no fills, so they read on GitHub's light and dark themes.
