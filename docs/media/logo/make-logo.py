"""EMCC's sentinel, drawn pixel by pixel: writes emcc-sentinel.svg (still) and the frames of the GIF.

    python3 docs/media/logo/make-logo.py OUT_DIR

A 40 x 36 figure, padded to 48 x 36 so its body is centred, in Anthropic's palette (clay, olive, stone, light, dark) and two tones of clay for
light and shade. The sentinel looks left and right, blinks, and raises a sign: a check in olive,
and now and then a triangle in clay, as witness marks a step proven or flagged.
"""
import math
import os
import sys

PALETTE = {
    'C': '#d97757',  # clay: helmet and body
    'L': '#e9a58a',  # light clay: shine and belt
    'K': '#b8613f',  # dark clay: shade and boots
    'D': '#3a3936',  # the visor, a step off the terminal's own dark
    'E': '#faf9f5',  # the eyes
    'S': '#b0aea5',  # stone: the sign's frame, its pole, the buckle
    'W': '#faf9f5',  # the sign
    'O': '#788c5d',  # olive: the check
    'R': '#d97757',  # clay: the triangle
}
# The figure is drawn on columns 0 to 39 and its body is centred on 15.5; the sign reaches 38.
# LEFT pads the left as far as the sign reaches right, so the body sits in the middle of the image.
LEFT = 8
WIDTH, HEIGHT = 40 + LEFT, 36


def blank():
    return [['.'] * WIDTH for _ in range(HEIGHT)]


def put(cells, r, c, ch):
    c += LEFT
    if 0 <= r < HEIGHT and 0 <= c < WIDTH:
        cells[r][c] = ch


def rect(cells, r0, r1, c0, c1, ch):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            put(cells, r, c, ch)


def body(cells):
    # Helmet: a dome over rows 0-7, centred between columns 15 and 16, 8 wide each side at its base.
    for r in range(0, 8):
        half = round(8.4 * math.sqrt(max(0.0, 1 - ((7.6 - r) / 8.2) ** 2)))
        rect(cells, r, r, 16 - half, 15 + half, 'C')
    # The brim, two rows with rounded ends.
    rect(cells, 8, 8, 7, 24, 'C')
    rect(cells, 9, 9, 6, 25, 'C')
    put(cells, 9, 6, 'K'), put(cells, 9, 25, 'K')
    # Shine on the dome, shade on its right.
    for r, c in [(1, 12), (1, 13), (2, 11), (2, 12), (3, 10), (3, 11), (4, 10)]:
        put(cells, r, c, 'L')
    for r in range(2, 8):
        put(cells, r, 23 if r > 3 else 22, 'K')
    # Face: clay around a visor with rounded corners.
    rect(cells, 10, 14, 9, 22, 'C')
    rect(cells, 10, 13, 11, 20, 'D')
    put(cells, 10, 11, 'C'), put(cells, 10, 20, 'C'), put(cells, 13, 11, 'C'), put(cells, 13, 20, 'C')
    put(cells, 14, 9, '.'), put(cells, 14, 22, '.')
    rect(cells, 10, 14, 22, 22, 'K')
    # Neck and shoulders.
    rect(cells, 15, 15, 12, 19, 'C')
    rect(cells, 16, 16, 9, 22, 'C')
    rect(cells, 17, 19, 7, 24, 'C')
    put(cells, 17, 7, '.'), put(cells, 17, 24, '.')
    # Torso, with shade down its right and a belt with a buckle.
    rect(cells, 20, 27, 10, 21, 'C')
    rect(cells, 17, 27, 21, 21, 'K')
    rect(cells, 24, 25, 10, 21, 'L')
    rect(cells, 24, 25, 15, 16, 'S')
    # Left arm (the viewer's left), always down.
    rect(cells, 20, 25, 7, 8, 'C')
    rect(cells, 26, 26, 7, 8, 'L')
    # Legs and boots.
    rect(cells, 28, 32, 11, 14, 'C')
    rect(cells, 28, 32, 17, 20, 'C')
    rect(cells, 28, 32, 20, 20, 'K')
    rect(cells, 33, 35, 10, 14, 'K')
    rect(cells, 33, 35, 17, 21, 'K')
    put(cells, 33, 10, '.'), put(cells, 33, 21, '.')


# The eyes: two 2 x 3 whites inside the visor (columns 12 to 19), or a line while blinking.
EYES = {'centre': (13, 17), 'left': (12, 16), 'right': (14, 18)}


def eyes(cells, where):
    if where == 'shut':
        for c in (13, 14, 17, 18):
            put(cells, 12, c, 'E')
        return
    for c0 in EYES[where]:
        rect(cells, 11, 12, c0, c0 + 1, 'E')


def arm_down(cells):
    rect(cells, 20, 25, 23, 24, 'C')
    rect(cells, 26, 26, 23, 24, 'L')


CHECK = [(4, 35), (5, 34), (5, 35), (6, 33), (6, 34), (7, 29), (7, 32), (7, 33), (8, 29), (8, 30), (8, 31), (8, 32),
         (9, 30), (9, 31), (3, 35), (3, 36), (4, 36)]
TRIANGLE_ROWS = {3: (32, 33), 4: (32, 33), 5: (31, 34), 6: (31, 34), 7: (30, 35), 8: (30, 35), 9: (29, 36), 10: (29, 36)}


def sign(cells, glyph):
    # The arm raised to the pole, the pole, then the board: stone frame, light inside.
    # Two pixels thick, like the other arm.
    for r, c in [(19, 24), (18, 24), (18, 25), (17, 25), (17, 26), (16, 26), (16, 27), (15, 27), (15, 28),
                 (19, 25), (18, 26), (17, 27), (16, 28), (15, 29)]:
        put(cells, r, c, 'C')
    put(cells, 14, 28, 'L'), put(cells, 14, 29, 'L')
    rect(cells, 13, 15, 30, 31, 'S')
    rect(cells, 0, 12, 26, 38, 'S')
    rect(cells, 1, 11, 27, 37, 'W')
    if glyph == 'check':
        for r, c in CHECK:
            put(cells, r, c, 'O')
    else:
        for r, (c0, c1) in TRIANGLE_ROWS.items():
            rect(cells, r, r, c0, c1, 'R')


def grid(where='centre', glyph=None):
    cells = blank()
    body(cells)
    eyes(cells, where)
    if glyph is None:
        arm_down(cells)
    else:
        sign(cells, glyph)
    return cells


def svg(cells, scale=1):
    rects = []
    for r, row in enumerate(cells):
        for c, ch in enumerate(row):
            if ch != '.':
                rects.append(f'<rect x="{c}" y="{r}" width="1" height="1" fill="{PALETTE[ch]}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH * scale}" height="{HEIGHT * scale}" '
            f'viewBox="0 0 {WIDTH} {HEIGHT}" shape-rendering="crispEdges">' + ''.join(rects) + '</svg>\n')


# (eyes, sign, frames at 10 fps)
LOOP = [
    ('centre', None, 8), ('left', None, 7), ('centre', None, 3), ('right', None, 7), ('centre', None, 3),
    ('shut', None, 2), ('centre', None, 4), ('centre', 'check', 14), ('centre', None, 6),
    ('left', None, 6), ('right', None, 6), ('shut', None, 2), ('centre', None, 4),
    ('centre', 'flag', 12), ('centre', None, 4), ('shut', None, 2), ('centre', None, 6),
]

if __name__ == '__main__':
    out = sys.argv[1]
    frames = os.path.join(out, 'frames')
    os.makedirs(frames, exist_ok=True)
    open(os.path.join(out, 'emcc-sentinel.svg'), 'w').write(svg(grid('centre', 'check'), scale=4))
    n = 0
    for where, glyph, count in LOOP:
        for _ in range(count):
            open(os.path.join(frames, f'{n:03d}.svg'), 'w').write(svg(grid(where, glyph), scale=4))
            n += 1
    print(n, 'frames')
