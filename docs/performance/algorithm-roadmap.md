# Sequential analysis optimizations

Apply and measure one change at a time. Use `-O2` on the same Ubuntu runner class,
compare cold builds, and separate seed construction, source analysis, IR decoding,
C++ generation and native compilation. A single runner measurement is provisional;
repeat a candidate before deciding to retain it based on a small timing difference.

Baseline: Actions run [42488323584](https://github.com/realprosl/estatic_ts/actions/runs/42488323584),
commit b9120371e14b9220f3f44dd1a5b34797d9c5fac5. The O2 source-analysis
measurement was 1,245.997 seconds. Both generations, all 67 execution fixtures,
11 native annotation tests, IR equality and streaming round-trip passed.

| Step | Change | Required verification | Status |
|---|---|---|---|
| 1a | Schedule only dirty effect edges using indexed outgoing edges | Checker suite, late callable edges, hidden alias rejection, selfhost and exact IR equality | Implemented; validation in progress |
| 1b | Schedule dependent call sites only when their inputs change | Callback, returned callable, async/resume and unknown-target regressions; differential comparison | Pending result of 1a |
| 2 | Index local symbols, receiver and constructor fields by function | Ownership, partial moves, recursion, field initialization; compare state and diagnostic results | Pending |
| 3 | Reuse transfer summaries for explicitly modeled contexts | Generic substitutions, aliases, globals, callbacks, creation/resume and caller diagnostics | Pending design and differential tests |
| 4 | Iterate recursive summaries by strongly connected components | Mutual recursion, dynamic call targets and convergence tests | Pending |
| 5 | Compact local states and intern memory paths; compare sparse/bitset representations | Joins, loops, wildcard paths, captures and memory consumption | Pending |

## Step 1a

The existing solver already propagates only newly inserted facts per edge. This
change additionally avoids revisiting clean edges. A deduplicated priority agenda
preserves the original ascending edge order. If an already visited edge becomes
dirty, it is deferred to the next round. Call resolution still runs once per round;
it is intentionally not changed in this step. A new edge is always scheduled, so
it receives facts discovered before that edge existed.

The verbose completion line reports actual edge visits, the visit count of the
corresponding dense rounds, edge count, round count and graph elapsed milliseconds.
Fewer edge visits alone do not prove lower elapsed time: agenda overhead must also
be measured. Keep all validations and compare diagnostics as well as accepted IR.
The native seed and ETS-generated compiler must emit byte-identical compiler IR.
