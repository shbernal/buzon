"""Builds how-it-works-{dark,light}.src.svg (live text) for both Tokyo Night themes."""
import sys, pathlib

THEMES = {
    "dark": dict(bg="#1a1b26", panel="#1f2335", line="#3b4261", node="#24283b", fg="#c0caf5",
                 muted="#9aa5ce", faint="#737aa2", blue="#7aa2f7", purple="#bb9af7",
                 cyan="#7dcfff", green="#9ece6a", yellow="#e0af68", arrow="#a9b1d6"),
    "light": dict(bg="#e1e2e7", panel="#d5d6db", line="#a8aecb", node="#e9e9ed", fg="#3760bf",
                  muted="#4c5a8f", faint="#6172b0", blue="#2e7de9", purple="#9854f1",
                  cyan="#007197", green="#587539", yellow="#8c6c3e", arrow="#4c5a8f"),
}
SANS = "Noto Sans"
MONO = "JetBrainsMono NF"
W, H = 1054, 450

def box(x, y, w, h, accent, title, sub=None, mono_sub=False, c=None):
    cx = x + w / 2
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{c["node"]}" stroke="{c[accent]}" stroke-width="1.6"/>']
    if sub:
        out.append(f'<text x="{cx}" y="{y + h/2 - 4}" text-anchor="middle" font-family="{SANS}" font-weight="600" font-size="15" fill="{c["fg"]}">{title}</text>')
        fam = MONO if mono_sub else SANS
        out.append(f'<text x="{cx}" y="{y + h/2 + 16}" text-anchor="middle" font-family="{fam}" font-size="11.5" fill="{c["muted"]}">{sub}</text>')
    else:
        out.append(f'<text x="{cx}" y="{y + h/2 + 5}" text-anchor="middle" font-family="{SANS}" font-weight="600" font-size="15" fill="{c["fg"]}">{title}</text>')
    return "\n".join(out)

def cyl(x, y, w, h, accent, title, sub, mono_title=False, c=None):
    e = 9
    cx = x + w / 2
    body = (f'<path d="M{x} {y+e} A{w/2} {e} 0 0 1 {x+w} {y+e} V{y+h-e} A{w/2} {e} 0 0 1 {x} {y+h-e} Z" '
            f'fill="{c["node"]}" stroke="{c[accent]}" stroke-width="1.6"/>')
    lid = f'<path d="M{x} {y+e} A{w/2} {e} 0 0 0 {x+w} {y+e}" fill="none" stroke="{c[accent]}" stroke-width="1.6"/>'
    fam = MONO if mono_title else SANS
    t1 = f'<text x="{cx}" y="{y + h/2 + 4}" text-anchor="middle" font-family="{fam}" font-weight="600" font-size="{14 if mono_title else 15}" fill="{c["fg"]}">{title}</text>'
    t2 = f'<text x="{cx}" y="{y + h/2 + 23}" text-anchor="middle" font-family="{SANS}" font-size="11.5" fill="{c["muted"]}">{sub}</text>'
    return "\n".join([body, lid, t1, t2])

def arrow(d, c, both=False, dash=False):
    extra = ' marker-start="url(#tail)"' if both else ""
    da = ' stroke-dasharray="5 4"' if dash else ""
    return f'<path d="{d}" fill="none" stroke="{c["arrow"]}" stroke-width="1.6"{da} marker-end="url(#head)"{extra}/>'

def label(x, y, s, c, mono=False, anchor="middle", size=12, color="muted", weight="400"):
    fam = MONO if mono else SANS
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{c[color]}">{s}</text>'

def panel(x, y, w, h, title, accent, c):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{c["panel"]}" stroke="{c["line"]}" stroke-width="1.2"/>\n'
            f'<text x="{x+18}" y="{y+26}" font-family="{SANS}" font-weight="700" font-size="11.5" letter-spacing="1.6" fill="{c[accent]}">{title}</text>')

def chip(x, y, w, h, tier, l1, l2, accent, c):
    cx = x + w / 2
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c["node"]}" stroke="{c[accent]}" stroke-width="1.2" stroke-dasharray="3 3"/>\n'
            f'<text x="{cx}" y="{y+22}" text-anchor="middle" font-family="{MONO}" font-weight="700" font-size="14" fill="{c[accent]}">{tier}</text>\n'
            f'<text x="{cx}" y="{y+40}" text-anchor="middle" font-family="{SANS}" font-size="11" fill="{c["muted"]}">{l1}</text>\n'
            f'<text x="{cx}" y="{y+55}" text-anchor="middle" font-family="{SANS}" font-size="11" fill="{c["muted"]}">{l2}</text>')

def build(c):
    p = []
    p.append(f'<rect width="{W}" height="{H}" rx="18" fill="{c["bg"]}"/>')
    p.append(panel(300, 40, 400, 390, "CLOUDFLARE", "yellow", c))
    p.append(panel(810, 40, 220, 390, "YOUR MACHINE", "green", c))
    # Sender
    p.append(box(24, 200, 150, 80, "purple", "Sign-up form", "any website", c=c))
    p.append(arrow("M174 240 H314", c))
    p.append(label(242, 226, "ste-2610-9qa", c, mono=True, size=11))
    p.append(label(242, 260, "@example.com", c, mono=True, size=11))

    # Cloudflare
    p.append(box(320, 85, 160, 80, "yellow", "Daily cron", "tier cleanup SQL", c=c))
    p.append(cyl(520, 80, 160, 90, "cyan", "D1", "addresses and mail", c=c))
    p.append(arrow("M480 125 H514", c))
    p.append(box(320, 200, 160, 80, "blue", "Email Routing", "catch-all on example.com", c=c))
    p.append(box(520, 200, 160, 80, "blue", "Worker", "cloudflare_temp_email", mono_sub=True, c=c))
    p.append(arrow("M480 240 H514", c))
    p.append(arrow("M600 199 V176", c, both=True))
    # Tier legend
    p.append(label(320, 318, "The cron deletes by the tier in each name", c, anchor="start", size=11.5, color="faint"))
    p.append(chip(320, 330, 112, 72, "ste", "mail 7 days", "address 30 days", "cyan", c))
    p.append(chip(444, 330, 112, 72, "mte", "mail 180 days", "180 days idle", "yellow", c))
    p.append(chip(568, 330, 112, 72, "lte", "kept", "until deleted", "green", c))

    # API
    p.append(arrow("M824 240 H686", c, both=True))
    p.append(label(755, 226, "HTTPS API", c, size=12, color="fg", weight="600"))
    p.append(label(755, 262, "new · wait", c, mono=True, size=11))
    p.append(label(755, 277, "read · delete", c, mono=True, size=11))

    # Your machine
    p.append(box(830, 80, 84, 48, "purple", "You", c=c))
    p.append(box(926, 80, 84, 48, "purple", "AI agent", c=c))
    p.append(arrow("M872 128 V194", c))
    p.append(arrow("M968 128 V194", c))
    p.append(label(974, 166, "skill", c, anchor="start", size=11, mono=True))
    p.append(box(830, 200, 180, 80, "green", "buzon", "Bun CLI", c=c))
    p.append(arrow("M920 281 V314", c, both=True))
    p.append(cyl(830, 320, 180, 90, "green", "registry.json", "tier, site and note per address", mono_title=True, c=c))

    defs = f'''<defs>
<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="{c["arrow"]}"/></marker>
<marker id="tail" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M10 0 L0 5 L10 10 z" fill="{c["arrow"]}"/></marker>
</defs>'''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img">\n'
            f'<title>How buzon works</title>\n{defs}\n' + "\n".join(p) + "\n</svg>\n")

out = pathlib.Path(sys.argv[1])
for name, c in THEMES.items():
    (out / f"how-it-works-{name}.src.svg").write_text(build(c))
