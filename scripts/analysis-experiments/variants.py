#!/usr/bin/env python3
"""Apply isolated, fail-closed experiments to the queue-only reference."""
from pathlib import Path
import sys

NAMES = ('control', 'summary-fields', 'module-search', 'call-metadata', 'path-prefix', 'combined')

def replace(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Expected exactly one patch site: {old[:90]!r}')
    return text.replace(old, new)

def apply(root, variant):
    if variant not in NAMES:
        raise ValueError(variant)
    effects = root / 'bootstrap/checker/effects.ets'
    safety = root / 'bootstrap/checker/safety.ets'
    e, s = effects.read_text(), safety.read_text()
    if variant in ('summary-fields', 'combined'):
        start = e.index('        const summary = this.summaries[target];', e.index('let graphPass:'))
        end = e.index('\n      }\n      }', start)
        block = e[start:end]
        block = block.replace('        const summary = this.summaries[target];\n', '')
        block = block.replace('summary.parameters', 'this.summaries[target].parameters')
        e = e[:start] + block + e[end:]
    if variant in ('module-search', 'combined'):
        e = replace(e, 'let m: number = 0; for (let at: number = 0; at < this.offsets.length; at = at+1) if (this.offsets[at] <= vertex) m = at; return m;', '''let low: number = 0; let high: number = this.offsets.length;
    while (low < high) {
      const middle: number = Math.floor((low+high)/2);
      if (this.offsets[middle] <= vertex) low = middle+1; else high = middle;
    }
    return low > 0 ? low-1 : 0;''')
    if variant in ('call-metadata', 'combined'):
        # Hoist only immutable AST/type queries; callTargets remains dynamic.
        start = e.index('      const callNode: number = this.calls[callIndex].node;')
        end = e.index('\n      for (const call of this.calls)', start)
        block = e[start:end]
        block = block.replace('      for (const target of', '''      const callbacks: boolean = this.synchronousCallbacks(callModule,callNode).length > 0;
      const suspended: boolean = this.suspensionNode(callModule,callNode);
      for (const target of''', 1)
        block = block.replace('if (this.synchronousCallbacks(callModule,callNode).length > 0)', 'if (callbacks)')
        block = block.replace('!this.suspensionNode(callModule,callNode)', '!suspended')
        block = block.replace('        const suspended: boolean = this.suspensionNode(callModule,callNode);\n', '')
        e = e[:start]+block+e[end:]
    if variant in ('path-prefix', 'combined'):
        s = replace(s, '''    for (let at: number = 0; at < state.paths.length; at = at+1) if (state.paths[at] == projectionKey || state.paths[at].startsWith(projectionKey + "/")) state.resources[at] = 1;''', '''    const childPrefix: string = projectionKey + "/";
    for (let at: number = 0; at < state.paths.length; at = at+1) if (state.paths[at] == projectionKey || state.paths[at].startsWith(childPrefix)) state.resources[at] = 1;''')
        s = replace(s, '''    for (let at: number = 0; at < saved.paths.length; at = at+1) if (saved.paths[at] == prefix || saved.paths[at].startsWith(prefix + "/")) this.setPath(state,saved.paths[at],saved.resources[at]);''', '''    const childPrefix: string = prefix + "/";
    for (let at: number = 0; at < saved.paths.length; at = at+1) if (saved.paths[at] == prefix || saved.paths[at].startsWith(childPrefix)) this.setPath(state,saved.paths[at],saved.resources[at]);''')
    effects.write_text(e)
    safety.write_text(s)

if __name__ == '__main__':
    apply(Path(__file__).resolve().parents[2], sys.argv[1])
