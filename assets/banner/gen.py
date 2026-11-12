#!/usr/bin/env python3
"""Generate the buzon postage-stamp banners (light and dark) as SVG with live text.

build.sh converts the text to paths with Inkscape afterwards.
"""
import math
import pathlib
import sys

W, H = 1280, 360
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent)

PALETTES = {
    "light": dict(
        paper="#F3EAD6",   # cream stamp paper
        ink="#1B2A4A",     # navy ink
        blue="#2F5FA7",    # mailbox blue
        side="#21457E",    # mailbox side
        red="#C8452F",     # red accent
        plate="#F3EAD6",
        dot="#1B2A4A",
        sun="#E8D9B5",
        leg="#1B2A4A",
        envink="#1B2A4A",
        shadow="#1B2A4A",
    ),
    "dark": dict(
        paper="#16243F",
        ink="#F1E6CC",
        blue="#3E74C4",
        side="#2A5596",
        red="#E2603F",
        plate="#F1E6CC",
        dot="#0C1528",
        sun="#1E3156",
        leg="#2A5596",
        envink="#16243F",
        shadow="#3E74C4",
    ),
}


def perforation_mask():
    r, step = 7.5, 24.0
    holes = []
    nx = round(W / step)
    sx = W / nx
    for i in range(nx + 1):
        x = i * sx
        holes.append(f'<circle cx="{x:.1f}" cy="0" r="{r}"/>')
        holes.append(f'<circle cx="{x:.1f}" cy="{H}" r="{r}"/>')
    ny = round(H / step)
    sy = H / ny
    for j in range(1, ny):
        y = j * sy
        holes.append(f'<circle cx="0" cy="{y:.1f}" r="{r}"/>')
        holes.append(f'<circle cx="{W}" cy="{y:.1f}" r="{r}"/>')
    return (
        '<mask id="perf" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="360">'
        f'<rect width="{W}" height="{H}" fill="#fff"/>'
        f'<g fill="#000">{"".join(holes)}</g></mask>'
    )


# Mailbox geometry (front face).
X0, X1 = 128, 292          # front face left/right
YA = 150                   # where the arch meets the straight sides
YP = 96                    # arch peak
YB = 288                   # bottom of the body
DX, DY = 40, -16           # depth offset (3/4 view)


def body_path(dx=0.0, dy=0.0):
    rx = (X1 - X0) / 2
    ry = YA - YP
    return (
        f"M{X0+dx:.1f},{YB+dy:.1f} L{X0+dx:.1f},{YA+dy:.1f} "
        f"A{rx},{ry} 0 0 1 {X1+dx:.1f},{YA+dy:.1f} "
        f"L{X1+dx:.1f},{YB+dy:.1f} Z"
    )


def leg(x_top, w_top, flare, y0, y1, fill):
    # A steel leg that splays outward into a foot.
    xa, xb = x_top, x_top + w_top
    return (
        f'<path d="M{xa},{y0} L{xb},{y0} L{xb+flare*0.3:.1f},{y1-5} '
        f'L{xb+flare:.1f},{y1-5} L{xb+flare:.1f},{y1} L{xa-flare:.1f},{y1} '
        f'L{xa-flare:.1f},{y1-5} L{xa-flare*0.3:.1f},{y1-5} Z" fill="{fill}"/>'
    )


def mailbox(p):
    s = []
    ground = 320
    # Halftone ground shadow.
    s.append(
        f'<ellipse cx="{(X0+X1)/2+DX/2+6:.1f}" cy="{ground}" rx="128" ry="9" fill="url(#dots-dense)"/>'
    )
    # Back legs (visible through the depth offset).
    s.append(leg(X1 + DX - 18, 12, 4, YB + DY - 2, ground - 9, p["leg"]))
    s.append(leg(X0 + DX + 8, 12, 4, YB + DY - 2, ground - 9, p["leg"]))
    # Extrusion: stacked copies of the body silhouette towards the back.
    n = 30
    copies = "".join(
        f'<path d="{body_path(DX*i/n, DY*i/n)}"/>' for i in range(1, n + 1)
    )
    s.append(f'<g fill="{p["side"]}">{copies}</g>')
    s.append(f'<g fill="url(#dots)">{copies}</g>')
    # Front face.
    s.append(f'<path d="{body_path()}" fill="{p["blue"]}"/>')
    # Rim inside the arch.
    rx = (X1 - X0) / 2 - 9
    ry = YA - YP - 9
    s.append(
        f'<path d="M{X0+9},{YA+2} A{rx},{ry} 0 0 1 {X1-9},{YA+2}" fill="none" '
        f'stroke="{p["side"]}" stroke-width="3"/>'
    )
    s.append(
        f'<path d="M{X0+16},{YA-4} A{rx-7},{ry-7} 0 0 1 {(X0+X1)/2-8},{YP+16}" fill="none" '
        f'stroke="{p["plate"]}" stroke-width="3.5" stroke-linecap="round" opacity="0.55"/>'
    )
    # Halftone shading on the left edge of the front face.
    s.append(
        f'<rect x="{X0}" y="{YA}" width="22" height="{YB-YA}" fill="url(#dots)"/>'
    )
    # Pull-down chute door.
    cx0, cx1, cy0, cy1 = X0 + 16, X1 - 16, 160, 212
    s.append(
        f'<rect x="{cx0}" y="{cy0}" width="{cx1-cx0}" height="{cy1-cy0}" rx="6" '
        f'fill="{p["side"]}"/>'
    )
    s.append(
        f'<rect x="{cx0+5}" y="{cy0+5}" width="{cx1-cx0-10}" height="{cy1-cy0-10}" rx="4" '
        f'fill="{p["blue"]}"/>'
    )
    # Slot under the door lip.
    s.append(
        f'<rect x="{cx0+12}" y="{cy0+11}" width="{cx1-cx0-24}" height="6" rx="3" fill="{p["dot"]}"/>'
    )
    # Handle.
    hx = (X0 + X1) / 2
    s.append(
        f'<rect x="{hx-30}" y="{cy1-22}" width="60" height="11" rx="5.5" fill="{p["plate"]}"/>'
    )
    s.append(
        f'<rect x="{hx-30}" y="{cy1-14}" width="60" height="3" rx="1.5" fill="{p["side"]}" opacity="0.55"/>'
    )
    # Label plate.
    s.append(
        f'<rect x="{hx-34}" y="226" width="68" height="26" rx="2" fill="{p["plate"]}"/>'
    )
    s.append(
        f'<text x="{hx}" y="244.5" text-anchor="middle" fill="{p["side"]}" '
        f'style="font-family:\'Noto Sans\';font-weight:900;font-stretch:extra-condensed;'
        f'font-size:17px;letter-spacing:1.5px">buzon</text>'
    )
    # Seam and kick plate.
    s.append(
        f'<rect x="{X0}" y="264" width="{X1-X0}" height="3" fill="{p["side"]}"/>'
    )
    s.append(
        f'<rect x="{X0}" y="{YB-10}" width="{X1-X0}" height="10" fill="{p["side"]}"/>'
    )
    # Front legs.
    s.append(leg(X0 + 6, 13, 6, YB, ground, p["leg"]))
    s.append(leg(X1 - 19, 13, 6, YB, ground, p["leg"]))
    return "\n".join(s)


def envelope(p):
    # Airmail envelope dropping into the slot, clipped at the slot line.
    w, h = 84, 52
    stripe = 11
    # Border of alternating diagonal stripes, masked to a frame.
    stripes = "".join(
        f'<rect x="{-h + i*stripe:.1f}" y="-20" width="{stripe/2+0.5:.1f}" height="{h+40}" '
        f'fill="{p["red"] if i % 2 == 0 else p["blue"]}" transform="skewX(-35)"/>'
        for i in range((w + 2 * h) // stripe * 2)
    )
    return f"""
<clipPath id="slotclip"><rect x="0" y="0" width="{W}" height="172"/></clipPath>
<g clip-path="url(#slotclip)">
  <g transform="translate(186,136) rotate(-12)">
    <clipPath id="envclip"><rect x="0" y="0" width="{w}" height="{h}" rx="2"/></clipPath>
    <rect x="0" y="0" width="{w}" height="{h}" rx="2" fill="{p['plate']}"/>
    <g clip-path="url(#envclip)">
      <mask id="envframe" maskUnits="userSpaceOnUse" x="-10" y="-10" width="{w+20}" height="{h+20}">
        <rect x="-10" y="-10" width="{w+20}" height="{h+20}" fill="#fff"/>
        <rect x="6" y="6" width="{w-12}" height="{h-12}" fill="#000"/>
      </mask>
      <g mask="url(#envframe)">{stripes}</g>
    </g>
    <rect x="0" y="0" width="{w}" height="{h}" rx="2" fill="none" stroke="{p['envink']}" stroke-width="1.6"/>
    <rect x="{w-24}" y="11" width="13" height="16" fill="none" stroke="{p['envink']}" stroke-width="1.4"/>
    <path d="M14,24 H44 M14,31 H52 M14,38 H38" stroke="{p['envink']}" stroke-width="2" stroke-linecap="round"/>
  </g>
</g>"""


def postmark(p, cx, cy, r):
    ring_r = r - 15
    ring = (
        f"M{cx-ring_r},{cy} A{ring_r},{ring_r} 0 1 1 {cx+ring_r},{cy} "
        f"A{ring_r},{ring_r} 0 1 1 {cx-ring_r},{cy}"
    )
    waves = []
    for i in range(5):
        y = cy - 34 + i * 17
        x = cx + r + 10
        d = f"M{x},{y}"
        seg = 0
        while x < 1238:
            x2 = x + 22
            d += f" q11,{-7 if seg % 2 == 0 else 7} 22,0"
            x, seg = x2, seg + 1
        waves.append(d)
    return f"""
<g fill="none" stroke="{p['red']}" stroke-width="2.6" stroke-linecap="round" opacity="0.92">
  <circle cx="{cx}" cy="{cy}" r="{r}"/>
  <circle cx="{cx}" cy="{cy}" r="{r-30}" stroke-width="1.6"/>
  {''.join(f'<path d="{w}"/>' for w in waves)}
</g>
<path id="ring" d="{ring}" fill="none"/>
<text fill="{p['red']}" opacity="0.92" style="font-family:'Noto Sans';font-weight:700;font-stretch:condensed;font-size:13.5px;letter-spacing:5.0px">
  <textPath href="#ring" startOffset="0">SELF-HOSTED MAIL · EXAMPLE.COM ·</textPath>
</text>
<g fill="{p['red']}" opacity="0.92" style="font-family:'Noto Sans';font-stretch:condensed" text-anchor="middle">
  <text x="{cx}" y="{cy-6}" style="font-weight:700;font-size:11px;letter-spacing:2.5px">CODE</text>
  <text x="{cx}" y="{cy+16}" style="font-weight:900;font-size:22px;letter-spacing:1px">482913</text>
</g>"""


def banner(name):
    p = PALETTES[name]
    title_x = 432
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<title>buzon</title>
<defs>
  {perforation_mask()}
  <pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <circle cx="3" cy="3" r="1.25" fill="{p['dot']}" opacity="0.55"/>
  </pattern>
  <pattern id="dots-dense" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <circle cx="2.5" cy="2.5" r="1.3" fill="{p['shadow']}" opacity="0.6"/>
  </pattern>
  <pattern id="sundots" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <circle cx="4.5" cy="4.5" r="2.1" fill="{p['red']}"/>
  </pattern>
  <radialGradient id="sunfade" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0.55" stop-color="#fff"/>
    <stop offset="1" stop-color="#000"/>
  </radialGradient>
</defs>
<g mask="url(#perf)">
  <rect width="{W}" height="{H}" fill="{p['paper']}"/>
  <rect x="24" y="24" width="{W-48}" height="{H-48}" fill="none" stroke="{p['ink']}" stroke-width="2.5"/>
  <rect x="31" y="31" width="{W-62}" height="{H-62}" fill="none" stroke="{p['ink']}" stroke-width="1"/>

  <!-- sun -->
  <circle cx="232" cy="190" r="122" fill="{p['sun']}"/>
  <circle cx="232" cy="190" r="122" fill="url(#sundots)" opacity="0.5"/>

  {mailbox(p)}
  {envelope(p)}

  <!-- wordmark -->
  <g style="font-family:'Noto Sans';font-weight:900;font-stretch:extra-condensed;font-size:178px;letter-spacing:2px">
    <text x="{title_x+5}" y="{218+5}" fill="{p['red']}">buzon</text>
    <text x="{title_x}" y="218" fill="{p['ink']}">buzon</text>
  </g>
  <text x="{title_x+4}" y="64" fill="{p['red']}" style="font-family:'Noto Sans';font-weight:700;font-stretch:condensed;font-size:15px;letter-spacing:4.5px">TEMP MAIL ON YOUR OWN DOMAIN · CLOUDFLARE</text>
  <g fill="{p['ink']}" style="font-family:'Noto Serif';font-weight:600;font-stretch:condensed;font-style:italic;font-size:24px">
    <text x="{title_x+4}" y="268">Disposable and long-lived email addresses</text>
    <text x="{title_x+4}" y="299">on your own domain, for you and your agents.</text>
  </g>

  {postmark(p, 1024, 172, 72)}
</g>
</svg>
"""


for n in PALETTES:
    (OUT / f"src-{n}.svg").write_text(banner(n))
