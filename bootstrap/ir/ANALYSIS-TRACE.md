# analyzeProject diagnostic markers

The compiled `bootstrap/ir/demo.ets` frontend accepts `--trace`:

```sh
frontend bootstrap/ir/demo.ets --trace > project.ir.json 2> analysis.log
```

The normal invocation is quiet. The flag propagates through expansion, binding,
checking, safety and module-record construction. Tracing uses stderr; stdout
retains the normal IR JSON, including diagnostics and exit status.

Markers have the form `TRACE analyze.<phase> BEGIN`, `END` or `POINT`.
Normal and diagnostic returns balance BEGIN/END pairs. A crash or timeout can
leave phases open; the last unmatched BEGIN identifies the active phase.
Repeated phase names represent separate calls. A consumer should track a stack
of phase names, timestamp lines as they arrive, and preserve repetitions.

| Phase | Work observed |
| --- | --- |
| `loader` | Load and parse the module graph, before analyzeProject |
| `project` | Call to analyzeProject, including argument and return transfers |
| `expansion.construct` | Construct NativeExpansion |
| `expansion.run` | Execute expansion and transfer its result |
| `expansion.round.N` (POINT) | Start expansion round N (zero based) |
| `expansion.bind` | Bind a round of expansion |
| `expansion.search` | Search for the next generator invocation |
| `expansion.expand` | Expand the selected invocation |
| `expansion.order` | Assign generated AST analysis ranges |
| `binding.final` | Bind the expanded graph |
| `binding.construct`, `binding.run`, `binding.initialize` | Binder setup and execution |
| `binding.collect.N`, `binding.imports.N`, `binding.exports.N`, `binding.uses.N` | Pass for module index N |
| `binding.duplicates`, `binding.targets` | Duplicate checks and reference targets |
| `project.assemble` (POINT) | Boundary before checker invocation and assembling FrontendProject |
| `checker.construct`, `checker.run`, `checker.types` | Checker setup and type checking |
| `checker.safety`, `safety.construct` | Safety validation and analyzer construction |
| `safety.memory`, `safety.captures`, `safety.effects`, `safety.provenance`, `safety.visibility`, `safety.flow` | Safety subpasses |
| `checker.comptime` | Compile-time evaluation |
| `checker.records.construct`, `checker.records.build` | Module record construction |
| `lower`, `format` | Later IR lowering and output |

Inner END markers precede existing return expressions. Their duration excludes
subsequent value transfers; outer call markers include those transfers. POINT
markers distinguish boundaries where adding a named result just to emit END
could introduce extra value copies. Existing coarse `frontend:` logs remain
available, but consumers should use the stable `TRACE analyze.` markers.

The tracing helper accepts only a boolean and short phase/event strings. It
never receives graphs, ASTs or checked results, and has no mutable global state.
No per-node logging is added. Error paths can skip safety or comptime phases;
absence of their markers must not be interpreted as successful completion.

Issue #63 adds and verifies this contract. Issue #64 performs the full timing,
CPU/RSS investigation. The existing self-host diagnostic invokes `--trace`
directly instead of rewriting source files to inject logging. Timeouts remain
unchanged; a diagnostic timeout still fails that workflow.
