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
| 1,001 | 0.0177 | 0.0011 | 0.0152 | 2.942 | 20,588 |
| 2,001 | 0.0343 | 0.0024 | 0.0285 | 2.717 | 20,576 |
| 4,001 | 0.0697 | 0.0050 | 0.0587 | 3.050 | 21,020 |
| 8,001 | 0.1423 | 0.0088 | 0.1096 | 3.024 | 21,608 |
| 16,001 | 0.3164 | 0.0209 | 0.2333 | 3.002 | 29,920 |
| 20,209 | 0.4007 | 0.0272 | 0.3416 | 4.226 | 32,880 |

Process CPU includes lexing and sample construction; constructor/phase timings
use stderr markers and a monotonic clock. Instrumentation and scheduling add
noise, so the microsecond-level access timings are diagnostic rather than an
absolute throughput guarantee. The final sample includes exactly 20,209 tokens.
Before the fix, the uninstrumented constructor took 1.118 s / 2.762 s / 10.635 s
for 1,001 / 2,001 / 4,001 tokens on the same machine. The corrected samples grow
approximately linearly and complete the full target in about 0.4 seconds.

## Validation scope

The regression suite checks metadata loops, one-time evaluation of temporary
receivers, independent array copies, reference receivers, and mutation such as
`xs.push(xs.length)`. A structural check requires the two backends to generate
identical C++, and requires multi-use snapshots to remain materialized.
The workflow runs on pull requests targeting `feature/native-self-hosting` and
retains the full generation checks.

Constructor performance is independently verified. Full second-generation
frontend analysis, IR emission and linking must be checked separately; these
measurements alone do not certify complete self-hosting or reproduction of the
native driver/backend.
