# Sequential analysis optimizations

Apply and measure one change at a time. Use `-O2` on the same Ubuntu runner class,
compare cold builds, and separate seed construction, source analysis, IR decoding,
C++ generation and native compilation. A single runner measurement is provisional;
repeat a candidate before deciding to retain it based on a small timing difference.

Baseline: Actions run [42488323584](https://github.com/realprosl/estatic_ts/actions/runs/42488323584),
commit b9120371e14b9220f3f44dd1a5b34797d9c5fac5. The O2 source-analysis
measurement was 1,245.997 seconds. Both generations, all 67 execution fixtures,
11 native annotation tests, IR equality and streaming round-trip passed.

| Priority | Change | Required verification | Status |
|---|---|---|---|
| P | Count symbol visits and profile invokeTarget/join/path operations separately | Attribute cost without double-counting nested calls | Owner-visit counters added; join/path timings pending |
| 1 | Index local symbols by lexical owner and hoist call receiver lookup | Ownership, captures, recursion, field initialization and diagnostic regressions | Implemented; validation in progress |
| 2 | Schedule only dirty effect edges | Checker suite, late callable edges, hidden aliases, selfhost and exact IR equality | Passed Actions 42492813189 |
| 3 | Intern paths and merge ordered path states | Identical path/value sets, wildcard overlap, branch joins and partial moves | Pending |
| 4 | Schedule dependent call sites only when their inputs change | Callbacks, returned callables, async/resume, unknown targets and differential comparison | Pending |
| 5 | Compact local slot states; compare sparse/bitset representations | Scope isolation, joins, loops, captures and memory consumption | Pending |
| 6 | Reuse transfer summaries for explicitly modeled contexts | Generics, aliases, globals, callbacks, creation/resume and caller diagnostics | Pending design and differential tests |
| 7 | Iterate recursive summaries by strongly connected components | Mutual recursion, dynamic call targets and convergence tests | Pending |

The original edge experiment was already in flight before this priority order
was revised. Do not attribute the next owner-index result to the queue alone.

## Confirmed edge experiment

[Actions 42492813189](https://github.com/realprosl/estatic_ts/actions/runs/42492813189)
passed both generations, all fixtures, exact IR comparison and round-trip checks.
The O2 source-analysis measurement was 727.151 seconds versus the previous
1,245.997 seconds. This is one measurement per version on different runners,
not a repeated controlled benchmark. The new counter observed 308,240 edge visits
versus 2,482,959 visits for the corresponding dense rounds. Graph construction
reported 266.270 seconds. These measurements justify keeping the queue as the
baseline for the isolated owner-index experiment.

## Owner-index experiment

A compact map translates lexical owner IDs to groups of symbol IDs. Each group
preserves ascending symbol order. The index is built once after the scope cache
and module offsets exist; it does not allocate one group per AST node. Only the
two global symbol scans in invokeTarget are replaced. Receiver lookup is hoisted
out of the local-symbol loop. Full state saving, path restoration, constructor
field handling and call-context semantics are unchanged. Verbose logs report
indexed symbol visits versus the two original global scans.

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
