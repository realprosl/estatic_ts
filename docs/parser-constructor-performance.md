# Parser constructor: issue #60

## Cause

The reference AST-to-C++ frontend generates direct `std::vector` accesses. The
native IR frontend used `load` to inspect metadata on copyable containers.
`load` is an intentional value copy: the C++ backend emits a
`Slot<std::vector<T>>::set(container.get())`, which copies every token. Thus
each `this.tokens.length` loop condition copies the complete token array.
Indexing itself uses `std::vector::at`, and token coordinate checks do not
explain the quadratic growth.

For example, the coordinate loop previously emitted:

```cpp
v71.set((ets::ir::view(*(p0.get())).get()).f0.get()); // deep copy of tokens
v72.set(double((v71.get()).size()));
```

Both IR C++ backends now fuse an adjacent, single-use `load` followed by a
metadata inspection. They query the original place directly and omit the
container copy. The check counts uses across the entire function, including
terminators and index projections, and does not fuse across intervening
instructions. Reference-valued loads and string character indexing retain
their existing path. Both implementations run a linear scan per function.

Ordinary assignments, arguments, returns and snapshots with multiple uses retain
their value semantics. Neither the Parser constructor, its EOF/span validations,
the IR format nor the borrow rules change. The portable snapshot includes the
same backend fix; its frontend C++ remains unchanged.

## Reproduction and measurements

Run from the repository root after `bash native-compiler-mini/build-all.sh`:

```sh
python3 scripts/bench-parser-constructor.py
```

The script compiles a separate instrumented parser and removes its temporary
sources after compilation. It measures isolated `.length`, indexed access,
the EOF loop, the coordinate loop and the complete constructor. Each process
has a 40 second deadline; doubling checks allow a small timing noise floor.
Logs, generated C++ and machine-readable results are under
`build/selfhost/constructor-bench/` and are uploaded by the self-hosting workflow.
The code generation regression additionally rejects whole-array copies in a metadata loop,
without depending on machine speed.

Local Linux/g++ 13.3 results (2026-11-05), with zero parser diagnostics:

| Tokens including EOF | Constructor s | EOF scan s | Coordinate scan s | Process CPU s | Peak RSS KiB |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,001 | 0.0133 | 0.0000 | 0.0128 | 2.781 | 20,576 |
| 2,001 | 0.0300 | 0.0020 | 0.0259 | 2.730 | 20,632 |
| 4,001 | 0.0710 | 0.0049 | 0.0602 | 2.765 | 21,056 |
| 8,001 | 0.1367 | 0.0081 | 0.1185 | 3.217 | 21,736 |
| 16,001 | 0.2777 | 0.0148 | 0.2372 | 3.292 | 30,388 |
| 20,209 | 0.4758 | 0.0237 | 0.3816 | 3.272 | 33,344 |

Process CPU includes lexing and sample construction; constructor/phase timings
use stderr markers and a monotonic clock. Instrumentation and scheduling add
noise, so the microsecond-level access timings are diagnostic rather than an
absolute throughput guarantee. The final sample includes exactly 20,209 tokens.
Before the fix, the uninstrumented constructor took 1.118 s / 2.762 s / 10.635 s
for 1,001 / 2,001 / 4,001 tokens on the same machine. The corrected samples grow
approximately linearly and complete the full target in about 0.48 seconds.

## Validation scope

The regression suite checks metadata loops, one-time evaluation of temporary
receivers, independent array copies, and mutation such as
`xs.push(xs.length)`. A structural check requires the two backends to generate
identical executable C++ (excluding comments), and requires multi-use snapshots to remain materialized.
The workflow runs on pull requests targeting `feature/native-self-hosting` and
retains the full generation checks.

The three metadata regressions pass against each backend (3/3 reference, 3/3 native).
The complete native runtime suite is limited locally by missing `uv.h`; CI installs
libuv before running the integration checks.

Constructor performance is independently verified. Full second-generation
frontend analysis, IR emission and linking must be checked separately; these
measurements alone do not certify complete self-hosting or reproduction of the
native driver/backend.
