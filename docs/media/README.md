# How the screenshots and recordings are made

Every image and video in EMCC's READMEs is a real Claude Code session, recorded from a script with [VHS](https://github.com/charmbracelet/vhs). Nothing is drawn or mocked up, and anyone can record them again.

## Record them again

You need Claude Code (signed in), VHS (`brew install vhs`), Node and ffmpeg.

```sh
docs/media/tapes/make-demo-repo.sh      # builds ~/Developer/emcc-demo (or the path you pass, or $EMCC_DEMO)
docs/media/tapes/record.sh              # scenes a, b and c into docs/media/tapes/out/
docs/media/tapes/record.sh a            # one scene
```

The sessions load the mods from this repo with `--plugin-dir`, so what is recorded is what is committed, whether or not you have the mods installed. They run Haiku 4.5: Opus fixes the failing test properly on its own, so it never shows a guard at work.

A scene is a real model session, so a take can go another way (Haiku may fix the code without trying a shortcut). `record.sh` retries a scene until its last screenshot exists, resets the demo repo before every take, and removes from your goalpost-guard store the exceptions a take saved for the demo repo.

## The scenes

| Tape | What happens | Images |
|---|---|---|
| [`scene-a.tape`](tapes/scene-a.tape) | Told `src/` is frozen, Claude rewrites the test's expected value; goalpost-guard holds it; the answer, typed in the dialog, sends Claude back to fix `src/cart.js` | `demo.gif`, `demo.mp4`, `dialog.png`, `dialog-card.png`, `answer.png`, `fixed.png`, `fixed-card.png` |
| [`scene-b.tape`](tapes/scene-b.tape) | One change held, one allowed for the file and committed with its `Goalpost-Change` trailer, then the ledger's three tabs | `ledger.png`, `exceptions.png`, `rules.png`, `commit.png` |
| [`scene-c.tape`](tapes/scene-c.tape) | `/goalposts audit main` on a branch that already lowered the bar | `audit.png` |

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

The cut points depend on the take: find them by looking at the frames (`ffmpeg -i tapes/out/scene-a.mp4 -vf fps=2 frame%03d.png`).

## Icons

[`docs/icons`](../icons) holds EMCC's own line icons: 24 px, 1.75 px strokes in `#d97757`, no fills, so they read on GitHub's light and dark themes.
