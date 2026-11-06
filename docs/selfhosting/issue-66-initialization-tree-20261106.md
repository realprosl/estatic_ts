# Isolated initialization verifier: tree indexing

The initialization verifier previously scanned every place for every store,
move and drop, and scanned every place again to find a parent's children.
It now builds a logical path tree once per function and maps each place ID to
its node. Equivalent paths share a node, including checked views and repeated
field/index projections. A separate physical child index preserves the old
parent-completion rule exactly. Stores visit the affected subtree; resource
moves and drops also invalidate ancestor aliases. No descendant lists are
materialized per write.

## Local validation, November 6, 2026

Both isolated executables were generated with the existing SRC compiler and
compiled with g++ 13.3.0, C++20, `-O0`, `-pthread`, `-fno-exceptions`.
These are process elapsed times, not full Bootstrap recompilation times.

First single-sample comparison:

| Independent stores | Before | Tree |
| --- | ---: | ---: |
| 256 | 64.4 ms | 15.7 ms |
| 512 | 212.5 ms | 29.3 ms |
| 1,024 | 778.0 ms | 49.9 ms |

The added scaling guard subsequently failed against the saved previous binary
(medians of three: 69.85 / 845.10 ms at 256 / 1,024 places) and passed against
the new binary (15.16 / 47.47 ms). Those two guard runs overlapped, so the exact
speedup from their timings should not be treated as a controlled benchmark.
The first comparison was sequential.

- 136 existing IR tests passed, including invalid IR, initialization,
  dominance, ownership, shadowing and cross-module argument regressions.
- Three new tests passed in 0.757 s total using the prebuilt profile binary.
- A preserved copy of the previous scan checks 1,056 transitions against the
  tree: mixed initial states, field aliases, checked views, nested projections,
  dereferences, constant indices 1/10, dynamic indices, unrelated roots, stores,
  resource moves and drops. Index reset between functions is checked too.
- The isolated verifier accepts initialized locals and reports every
  uninitialized load at 256, 512 and 1,024 places.
- The separate linear-CFG workload remains approximately quadratic: 1,024
  blocks took 1.986 s before and 2.163 s after in single observations. This
  change does not optimize dominance or establish a complete self-generation
  result. It adds index setup work; no overall Bootstrap speedup is claimed.

## Reproduction

The first command builds the small verifier-only executable once; the second
reuses it for short iterations. No loader, binder or checker runs inside the
profile process: it constructs IR and calls `IrVerifier.functionBody` directly.

```sh
node --experimental-strip-types --test bootstrap/ir/verification-scaling.test.ts
ESTATIC_VERIFICATION_PROFILE="$PWD/build/verification-profile/modules-demo" \
  node --experimental-strip-types --test bootstrap/ir/verification-scaling.test.ts
```

The new test is included in `npm test`. No workflows are restored. #66 remains
open and #71 remains draft pending validation of the complete native cycle.
