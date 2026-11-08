# Profiling the IR verifier

The profiler loads an existing ets-ir-2 compiler IR, then runs the ETS verifier
without repeating module loading, checking, lowering or C++ emission.

```bash
bash scripts/profile-ir-verifier.sh /path/to/stage2.ir.json
ESTATIC_IR_PROFILE_DIR=build/profile-borrows bash scripts/profile-ir-verifier.sh /path/to/stage2.ir.json borrows
ESTATIC_IR_PROFILE_DIR=build/profile-ownership bash scripts/profile-ir-verifier.sh /path/to/stage2.ir.json ownership
python3 scripts/report-ir-profile.py build/ir-profile/timings.tsv
```

Use separate output directories when running phases concurrently. The isolated
memory passes require an already verified IR; table validation runs first, but
they do not replace the full verifier. `all` is the default and runs every check.
The report explicitly marks incomplete runs. Nested totals overlap and must not
be summed. Decode time is reported separately and is not verification time.
Function-body measurements separate structure, reachability, fixed-point
dominance/initialization, and instruction validation. Profiling writes to stderr;
normal verifier diagnostics and the accepted IR are unchanged.

## Initial measurements, 2026-11-08

Input: stage2.ir.json from Actions run 42476804048, commit
513c3abe81629292c414f916d12d81815400944c. It contains 987 functions and
112,483 instructions. Profiler compiled with g++ -O1 in the local workspace.
These timings are not a controlled speed comparison against the GitHub runner
or the reference compiler. Some isolated runs overlap in time.

| Check | Observed time | Status |
|---|---:|---|
| IR tables | 0.278 s | Complete |
| Function contracts | 4.220 s | Complete, all functions |
| Module contracts | 0.002 s | Complete |
| Types, dispatch and effects | 0.010 s | Complete |
| Borrow routes | 3.828 s | Complete, zero diagnostics |
| Ownership routes | 8.156 s | Complete, zero diagnostics |
| Body dominance and initialization | At least 153.177 s | Partial, full run still in progress |
| Body instruction validation | At least 35.267 s | Partial, full run still in progress |

The body-dataflow check for the function named verifyOwnershipRoutes alone took
53.602 s; verifyShapeInstruction took 52.288 s. These measure verification of
those function bodies, not execution of the ownership or shape-verifier passes.
The body-dataflow check of lower.ets:run subsequently exceeded one minute before
completion. This distinguishes the expensive body analysis from the independently
measured, relatively short memory-verification passes.

All 133 IR regression tests passed after initial instrumentation. No verifier
optimizations or removed checks are included in this measurement change.
Comparison against the reference-generated C++ verifier remains unmeasured;
reading loops by reference versus copying aggregate values is a candidate to
investigate, not yet a quantified explanation.
