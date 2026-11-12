#!/usr/bin/env python3
"""Write the animated agent-session SVGs for the README, in a dark and a light theme.

Text is converted to glyph outlines, since an SVG loaded through <img> cannot use fonts.
The animation is CSS only. Every element's resting style is the finished scene, so a
renderer without animation shows the last frame.

Usage: python3 gen.py [out_dir]   (font: $BUZON_MONO_FONT, $BUZON_MONO_FONT_BOLD)
"""

import os
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_DIRS = ["/usr/share/fonts/TTF", "/usr/share/fonts/truetype/jetbrains-mono", "/usr/share/fonts"]
REGULAR = ["JetBrainsMonoNerdFont-Regular.ttf", "JetBrainsMono-Regular.ttf"]
BOLD = ["JetBrainsMonoNerdFont-Bold.ttf", "JetBrainsMono-Bold.ttf"]

THEMES = {
    "dark": {
        "bg": "#1a1b26", "bar": "#16161e", "border": "#292e42", "fg": "#c0caf5",
        "mu": "#565f89", "bl": "#7aa2f7", "pu": "#bb9af7", "gr": "#9ece6a", "ye": "#e0af68",
        "dots": ("#f7768e", "#e0af68", "#9ece6a"),
    },
    "light": {
        "bg": "#e1e2e7", "bar": "#d0d5e3", "border": "#c4c8da", "fg": "#3760bf",
        "mu": "#848cb5", "bl": "#2e7de9", "pu": "#9854f1", "gr": "#587539", "ye": "#8c6c3e",
        "dots": ("#f52a65", "#8c6c3e", "#587539"),
    },
}

WIDTH = 900
SIZE = 15  # font size, px
LINE = 25  # line height, px
PAD_X = 28
BAR_H = 38
TOP = BAR_H + 30  # baseline of the first line

CYCLE = 24.0  # seconds, including the hold on the final frame
FADE_IN = 0.25
FADE_OUT = 0.6  # at the end of the cycle, before the restart

ADDR = "mte-2611-acme-k3x@example.com"

# Each line: (appear_at_seconds, [(text, colour, bold)]). None is an empty line.
# "⎿" is drawn by hand: the font lacks it.
PROMPT = "sign me up for the Acme trial"
TYPE_START, TYPE_CHAR = 0.7, 0.055
TYPE_END = TYPE_START + len(PROMPT) * TYPE_CHAR
WAIT_START, CODE_AT = 7.9, 10.3

LINES = [
    (0.0, [("❯ ", "bl", True), (PROMPT, "fg", False)]),
    None,
    (3.0, [("● ", "fg", False), ("A trial lasts a few weeks, so it gets an ", "fg", False),
           ("mte", "pu", False), (" address.", "fg", False)]),
    None,
    (4.0, [("● ", "gr", False), ("Bash", "fg", True), ("(", "mu", False), ("buzon", "bl", False),
           (" new mte --site acme", "fg", False), (")", "mu", False)]),
    (4.8, [("  ⎿  ", "mu", False), (ADDR, "ye", False)]),
    None,
    (5.8, [("● ", "gr", False), ("Browser", "fg", True), ("(", "mu", False),
           ("fill email with the address, submit", "fg", False), (")", "mu", False)]),
    (6.7, [("  ⎿  ", "mu", False), ("\"We sent a 6-digit code to your inbox.\"", "mu", False)]),
    None,
    (7.4, [("● ", "gr", False), ("Bash", "fg", True), ("(", "mu", False), ("buzon", "bl", False),
           (f" wait {ADDR} --code --since 10m", "fg", False), (")", "mu", False)]),
    (CODE_AT, [("  ⎿  ", "mu", False), ("482913", "gr", True)]),
    None,
    (11.1, [("● ", "gr", False), ("Browser", "fg", True), ("(", "mu", False),
            ("enter 482913, submit", "fg", False), (")", "mu", False)]),
    (11.9, [("  ⎿  ", "mu", False), ("\"Welcome to Acme. Your trial ends in 14 days.\"", "mu", False)]),
    None,
    (12.8, [("● ", "fg", False), ("Done. Your Acme trial is active on ", "fg", False),
            (ADDR, "ye", False), (".", "fg", False)]),
]
WAIT_ROW = 11  # the code replaces a spinner on this row
SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def find_font(names, env):
    if os.environ.get(env):
        return os.environ[env]
    for d in FONT_DIRS:
        for n in names:
            p = Path(d) / n
            if p.exists():
                return str(p)
    sys.exit(f"no JetBrains Mono found; set {env} to a monospace .ttf")


class Glyphs:
    def __init__(self, path):
        self.font = TTFont(path)
        self.cmap = self.font.getBestCmap()
        self.gs = self.font.getGlyphSet()
        self.scale = SIZE / self.font["head"].unitsPerEm
        self.advance = self.font["hmtx"]["a"][0] * self.scale

    def outline(self, text, x, y):
        """Path data for text set from (x, baseline y), one cell per character."""
        d = []
        for i, ch in enumerate(text):
            cx = x + i * self.advance
            if ch == " ":
                continue
            if ch == "⎿":
                d.append(self.hook(cx, y))
                continue
            name = self.cmap.get(ord(ch))
            if name is None:
                sys.exit(f"font lacks {ch!r}")
            pen = SVGPathPen(self.gs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
            self.gs[name].draw(TransformPen(pen, (self.scale, 0, 0, -self.scale, cx, y)))
            d.append(pen.getCommands())
        return "".join(d)

    def hook(self, x, y):
        w, t = self.advance, 1.3
        left, top, bottom = x + w * 0.35, y - SIZE * 0.78, y - SIZE * 0.22
        return (f"M{left:.2f} {top:.2f}h{t}V{bottom - t:.2f}H{x + w:.2f}v{t}"
                f"H{left:.2f}Z")


def pct(t):
    return f"{max(0.0, min(100.0, t / CYCLE * 100)):.3f}%"


def keyframes_show(name, at):
    """Hidden until `at`, then shown until the end-of-cycle fade."""
    end = CYCLE - FADE_OUT
    if at <= 0:
        return f"@keyframes {name}{{0%,{pct(end)}{{opacity:1}}100%{{opacity:0}}}}"
    return (f"@keyframes {name}{{0%,{pct(at)}{{opacity:0}}{pct(at + FADE_IN)},{pct(end)}"
            f"{{opacity:1}}100%{{opacity:0}}}}")


def keyframes_window(name, start, stop):
    """Shown only between `start` and `stop`; hidden at rest."""
    return (f"@keyframes {name}{{0%,{pct(start)}{{opacity:0}}{pct(start + 0.01)},{pct(stop)}"
            f"{{opacity:1}}{pct(stop + 0.01)},100%{{opacity:0}}}}")


def build(theme, regular, bold):
    c = THEMES[theme]
    cw = regular.advance
    rows = len(LINES)
    height = TOP + (rows - 1) * LINE + 28
    css = [
        f".fg{{fill:{c['fg']}}}.mu{{fill:{c['mu']}}}.bl{{fill:{c['bl']}}}.pu{{fill:{c['pu']}}}"
        f".gr{{fill:{c['gr']}}}.ye{{fill:{c['ye']}}}",
    ]
    body = []

    for row, line in enumerate(LINES):
        if line is None:
            continue
        at, segs = line
        y = TOP + row * LINE
        col = 0
        paths = []
        for text, colour, is_bold in segs:
            d = (bold if is_bold else regular).outline(text, PAD_X + col * cw, y)
            if d:
                paths.append(f'<path class="{colour}" d="{d}"/>')
            col += len(text)
        cls = f"r{row}"
        css.append(keyframes_show(cls, at))
        css.append(f".{cls}{{animation:{cls} {CYCLE}s linear infinite}}")
        body.append(f'<g class="{cls}">{"".join(paths)}</g>')

    # Typing: a block cursor and a cover in the background colour step right across the
    # prompt, uncovering it a character at a time. Hidden at rest.
    y0 = TOP
    px = PAD_X + 2 * cw
    n = len(PROMPT)
    css.append(
        f"@keyframes type{{0%,{pct(TYPE_START)}{{transform:translateX(0);animation-timing-function:"
        f"steps({n},end)}}{pct(TYPE_END)}{{transform:translateX({n * cw:.2f}px)}}"
        f"100%{{transform:translateX({n * cw:.2f}px)}}}}"
    )
    css.append(keyframes_window("typing", 0, 2.6))
    css.append(f"@keyframes blink{{0%,50%{{opacity:1}}50.01%,100%{{opacity:0}}}}")
    css.append(f".typing{{opacity:0;animation:typing {CYCLE}s linear infinite}}")
    css.append(f".cover{{animation:type {CYCLE}s linear infinite}}")
    css.append(f".cursor{{animation:blink 1s linear infinite}}")
    body.append(
        f'<g class="typing"><g class="cover">'
        f'<rect x="{px:.2f}" y="{y0 - SIZE:.2f}" width="{n * cw + 2:.2f}" height="{LINE - 4}" fill="{c["bg"]}"/>'
        f'<rect class="cursor" x="{px:.2f}" y="{y0 - SIZE + 1:.2f}" width="{cw:.2f}" height="{SIZE + 4}" fill="{c["fg"]}"/>'
        f"</g></g>"
    )

    # Waiting: a spinner and "waiting for mail" on the row where the code lands. Hidden at rest.
    yw = TOP + WAIT_ROW * LINE
    frames = []
    k = len(SPINNER)
    for i, ch in enumerate(SPINNER):
        d = regular.outline(ch, PAD_X + 5 * cw, yw)
        frames.append(f'<path class="bl spin" style="animation-delay:{-i * 0.08:.2f}s" d="{d}"/>')
    css.append(f"@keyframes spin{{0%,{100 / k:.3f}%{{opacity:1}}{100 / k + 0.001:.3f}%,100%{{opacity:0}}}}")
    css.append(f".spin{{animation:spin {k * 0.08:.2f}s linear infinite}}")
    css.append(keyframes_window("waiting", WAIT_START, CODE_AT))
    css.append(f".waiting{{opacity:0;animation:waiting {CYCLE}s linear infinite}}")
    hook = regular.outline("  ⎿", PAD_X, yw)
    label = regular.outline("waiting for mail…", PAD_X + 7 * cw, yw)
    body.append(
        f'<g class="waiting"><path class="mu" d="{hook}"/>{"".join(frames)}'
        f'<path class="mu" d="{label}"/></g>'
    )

    # Window chrome.
    title = regular.outline("agent session", 0, 0)
    tw = len("agent session") * cw
    chrome = (
        f'<rect x="0.5" y="0.5" width="{WIDTH - 1}" height="{height - 1}" rx="10" fill="{c["bg"]}" stroke="{c["border"]}"/>'
        f'<path d="M0.5 {BAR_H}V10.5a10 10 0 0 1 10-10h{WIDTH - 21}a10 10 0 0 1 10 10V{BAR_H}Z" fill="{c["bar"]}"/>'
        f'<path d="M0.5 {BAR_H}H{WIDTH - 0.5}" stroke="{c["border"]}"/>'
        + "".join(
            f'<circle cx="{22 + i * 20}" cy="{BAR_H / 2}" r="6" fill="{col}"/>'
            for i, col in enumerate(c["dots"])
        )
        + f'<path class="mu" transform="translate({(WIDTH - tw) / 2:.2f} {BAR_H / 2 + SIZE * 0.35:.2f})" d="{title}"/>'
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" '
        f'viewBox="0 0 {WIDTH} {height}" role="img" aria-label="An AI agent signs up for a trial: '
        f'it runs buzon new mte --site acme, fills the form with the address, runs buzon wait --code '
        f'and enters the code 482913.">'
        f"<style>{''.join(css)}@media (prefers-reduced-motion:reduce){{*{{animation:none!important}}}}</style>"
        f"{chrome}{''.join(body)}</svg>\n"
    )


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
    out.mkdir(parents=True, exist_ok=True)
    regular = Glyphs(find_font(REGULAR, "BUZON_MONO_FONT"))
    bold = Glyphs(find_font(BOLD, "BUZON_MONO_FONT_BOLD"))
    for theme in THEMES:
        p = out / f"agent-session-{theme}.svg"
        p.write_text(build(theme, regular, bold))
        print(p)


if __name__ == "__main__":
    main()
