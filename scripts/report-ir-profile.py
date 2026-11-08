#!/usr/bin/env python3
"""Summarize verifier TSV timings; nested phase totals must not be added together."""
import argparse
from collections import defaultdict
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument("log", type=Path)
args = parser.parse_args()
rows = []
for line in args.log.read_text().splitlines():
    fields = line.split("\t")
    if len(fields) >= 3 and fields[0] == "IR_PROFILE":
        rows.append((fields[1], int(fields[2]), fields[3] if len(fields) > 3 else ""))
totals = defaultdict(int)
counts = defaultdict(int)
for phase, ms, name in rows:
    totals[phase] += ms
    counts[phase] += 1
print("Complete:", any(phase in {"verify.total", "borrows.total", "ownership.total"} for phase, _, _ in rows))
print("\n| Phase | Calls | Seconds |\n|---|---:|---:|")
for phase in sorted(totals):
    print(f"| {phase} | {counts[phase]} | {totals[phase]/1000:.3f} |")
print("\nNested totals overlap; do not sum all rows.")
print("\n| Slowest function checks | Phase | Seconds |\n|---|---|---:|")
for phase, ms, name in sorted((row for row in rows if row[2]), key=lambda row: row[1], reverse=True)[:20]:
    print(f"| {name.replace(chr(124), '/')} | {phase} | {ms/1000:.3f} |")
