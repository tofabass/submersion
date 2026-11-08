#!/usr/bin/env python3
"""Generates submersion-bridge.maxpat (paste into a new Max Audio Effect device).
Run: python3 -I gen-patcher.py   -> writes submersion-bridge.maxpat and checks the wiring."""
import json, sys

boxes, lines, ids = [], [], {}

def obj(key, text, x, y, nin, nout, w=None, h=22, **extra):
    n = len(boxes) + 1
    box = {"id": f"obj-{n}", "maxclass": "newobj", "text": text, "numinlets": nin, "numoutlets": nout,
           "outlettype": extra.pop("outlettype", [""] * nout), "patching_rect": [x, y, w or max(40, 7 * len(text) + 12), h]}
    box.update(extra)
    boxes.append({"box": box}); ids[key] = (box["id"], nin, nout)

def comment(key, text, x, y, w, pres=None, **extra):
    n = len(boxes) + 1
    box = {"id": f"obj-{n}", "maxclass": "comment", "text": text, "numinlets": 1, "numoutlets": 0,
           "patching_rect": [x, y, w, 20]}
    if pres: box["presentation"] = 1; box["presentation_rect"] = pres
    box.update(extra); boxes.append({"box": box}); ids[key] = (box["id"], 1, 0)

def dial(key, name, mn, mx, init, x, y, pres, exp=2.0):
    n = len(boxes) + 1
    box = {"id": f"obj-{n}", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
           "parameter_enable": 1, "patching_rect": [x, y, 44, 48], "presentation": 1, "presentation_rect": pres,
           "saved_attribute_attributes": {"valueof": {
               "parameter_longname": name, "parameter_shortname": name, "parameter_type": 0,
               "parameter_mmin": mn, "parameter_mmax": mx, "parameter_initial_enable": 1,
               "parameter_initial": [init], "parameter_unitstyle": 2, "parameter_exponent": exp}}}
    boxes.append({"box": box}); ids[key] = (box["id"], 1, 2)

def wire(a, ao, b, bi):
    (ia, _, no), (ib, ni, _) = ids[a], ids[b]
    if ao >= no or bi >= ni:
        sys.exit(f"bad wire {a}[{ao}] -> {b}[{bi}] (outlets {no}, inlets {ni})")
    lines.append({"patchline": {"source": [ia, ao], "destination": [ib, bi]}})

SIG = ["signal"]
# ---- audio in -> out (untouched) and mono tap ----
obj("pin", "plugin~", 30, 20, 1, 2, outlettype=["signal", "signal"])
obj("pout", "plugout~", 30, 90, 2, 0)
wire("pin", 0, "pout", 0); wire("pin", 1, "pout", 1)
obj("sum", "+~", 200, 60, 2, 1, outlettype=SIG); obj("half", "*~ 0.5", 200, 90, 2, 1, outlettype=SIG)
wire("pin", 0, "sum", 0); wire("pin", 1, "sum", 1); wire("sum", 0, "half", 0)

# ---- level: RMS over 1024 samples, peak every 16 ms ----
obj("rms", "average~ 1024 rms", 380, 130, 2, 1, outlettype=SIG)
obj("pk", "peakamp~ 16", 520, 130, 2, 1, outlettype=["float"])
wire("half", 0, "rms", 0); wire("half", 0, "pk", 0)

# ---- band split: cascaded Linkwitz-Riley crossovers (150 / 500 / 2000 / 6000 Hz) ----
edges = [150, 500, 2000, 6000]
prev = "half"; prev_out = 0; band_src = []
for i, f in enumerate(edges):
    k = f"x{i}"
    obj(k, f"cross~ {f}", 200 + i * 10, 150 + i * 60, 2, 2, outlettype=SIG + SIG)
    wire(prev, prev_out, k, 0)
    band_src.append((k, 0))          # low output = this band
    prev, prev_out = k, 1            # high output feeds the next crossover
band_src.append((prev, 1))           # last high output = treble

# ---- envelope per band: abs~ -> slide~ (attack/release from the dials) ----
for i, (src, so) in enumerate(band_src):
    y = 420 + i * 0
    obj(f"abs{i}", "abs~", 30 + i * 110, 400, 1, 1, outlettype=SIG)
    obj(f"sl{i}", "slide~ 48 1920", 30 + i * 110, 430, 3, 1, w=110, outlettype=SIG)   # ~1 ms up, ~40 ms down at 48 kHz
    obj(f"snap{i}", "snapshot~", 30 + i * 110, 470, 2, 1, outlettype=["float"])
    wire(src, so, f"abs{i}", 0); wire(f"abs{i}", 0, f"sl{i}", 0); wire(f"sl{i}", 0, f"snap{i}", 0)
obj("snapr", "snapshot~", 620, 470, 2, 1, outlettype=["float"])
wire("rms", 0, "snapr", 0)

# ---- 16 ms frame clock: fires right-to-left so the hot pack inlet (RMS) comes last ----
obj("metro", "metro 16 @active 1", 620, 380, 2, 1, w=130, outlettype=["bang"])
obj("trig", "t b b b b b b", 620, 410, 1, 6, w=100, outlettype=["bang"] * 6)
wire("metro", 0, "trig", 0)
wire("trig", 0, "snapr", 0)
for i in range(5): wire("trig", i + 1, f"snap{i}", 0)
obj("pack", "pack 0. 0. 0. 0. 0. 0. 0.", 30, 520, 7, 1, w=200, outlettype=[""])
wire("snapr", 0, "pack", 0); wire("pk", 0, "pack", 1)
for i in range(5): wire(f"snap{i}", 0, "pack", i + 2)
obj("pre", "prepend frame", 30, 555, 1, 1, outlettype=[""])
obj("node", "node.script bridge.js @autostart 1 @watch 0", 30, 590, 1, 2, w=290, outlettype=["", ""])
wire("pack", 0, "pre", 0); wire("pre", 0, "node", 0)

# ---- status display from node ----
obj("route", "route status clients", 340, 590, 1, 3, w=140, outlettype=["", "", ""])
obj("p1", "prepend set Bridge:", 340, 625, 1, 1, w=120); obj("p2", "prepend set Clients:", 480, 625, 1, 1, w=120)
comment("title", "Submersion Bridge", 700, 20, 150, pres=[10, 4, 200, 20])
comment("status", "Bridge: starting", 700, 60, 200, pres=[10, 30, 210, 20])
comment("clients", "Clients: 0", 700, 100, 200, pres=[10, 54, 210, 20])
wire("node", 0, "route", 0); wire("route", 0, "p1", 0); wire("route", 1, "p2", 0)
wire("p1", 0, "status", 0); wire("p2", 0, "clients", 0)

patch = {"patcher": {
    "fileversion": 1, "appversion": {"major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1},
    "classnamespace": "box", "rect": [60, 80, 900, 700], "openinpresentation": 1, "default_fontsize": 12.0,
    "default_fontface": 0, "default_fontname": "Arial", "gridonopen": 1, "gridsize": [15.0, 15.0],
    "boxes": boxes, "lines": lines, "dependency_cache": [], "autosave": 0}}
json.dump(patch, open("submersion-bridge.maxpat", "w"), indent=2)
# ready-to-load device: 'ampf' header, device type 'aaaa' (audio effect), then the patcher JSON
import struct
patch["patcher"]["devicewidth"] = 230.0
body = json.dumps(patch, indent=2).encode("utf8") + b"\n"
hdr = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) + b"ptch" + struct.pack("<I", len(body))
open("Submersion Bridge.amxd", "wb").write(hdr + body)
print(f"wrote submersion-bridge.maxpat and Submersion Bridge.amxd: {len(boxes)} objects, {len(lines)} connections, wiring OK")
