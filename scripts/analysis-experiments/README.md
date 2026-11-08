# Paired analysis experiments

Experimental branch only. The queue-only reference remains unchanged.

| Variant | Change |
| --- | --- |
| control | Fresh baseline rebuild, no algorithm change; estimates measurement noise. |
| summary-fields | Read immutable parameter fields directly when linking call edges, avoiding an entire EffectSummary copy. |
| module-search | Upper-bound binary search over sorted module offsets instead of a global linear scan. |
| call-metadata | Hoist AST-derived callback/suspension queries out of the target loop; dynamic callTargets still recomputes normally. |
| path-prefix | Allocate child path prefixes once per initialize/restore operation instead of once per recorded path. |
| combined | All four independent changes. |

Each matrix job builds both compilers from the same queue-only C++ seed using O2. It analyzes the exact same source checkout at ccbfe46610a83a426e247f58b2b08926cf5de1bd, at the same path, with syntax caching disabled by default. Baseline always runs first; the control estimates warm-cache/order noise. Repeat a promising result with reversed execution order before promoting it. Historical 703.850s is context, not the paired comparison threshold.

IR must match byte for byte. The patched native checker runs the complete positive and negative checker suite, and the candidate compiler runs CLI/build/round-trip smoke checks. Each analysis is capped at 1200s, and the job at 60 minutes. A timeout is a failed experiment, never a speedup. Artifacts retain the precise patch, CPU/wall/RSS measurements and phase logs. Stage-1 build timings are separate from execution measurements. This experiment measures analysis of fixed sources; full two-generation self-hosting is required before merging an eventual winner.

Local patch/source validation:

```sh
node --experimental-strip-types scripts/analysis-experiments/validate.mjs
```

Run one complete paired experiment on Ubuntu with the native dependencies installed:

```sh
bash scripts/analysis-experiments/run.sh summary-fields
```

The runner modifies checker sources and should be used in a disposable checkout.
