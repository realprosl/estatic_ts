#!/usr/bin/env python3
"""Compare complete binder output before/after the reference index on shared inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', required=True, type=Path)
parser.add_argument('--candidate', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
cases = {
    'chains': (0, {
        'main.ets': 'import * as a from "./a"; import * as b from "./b"; print(a.inner.value,b.inner.value); const o={value:3}; print(o.value);',
        'a.ets': 'export * as inner from "./left";',
        'b.ets': 'export * as inner from "./right";',
        'left.ets': 'export const value=1;', 'right.ets': 'export const value=2;',
    }),
    'generic': (0, {
        'main.ets': 'import * as ns from "./lib"; const v=new ns.Box<ns.Tag>(); print(v.field);',
        'lib.ets': 'export interface Tag{} export class Box<T>{field:number=1;}',
    }),
    'missing': (1, {'main.ets': 'import * as ns from "./lib"; print(ns.absent.value);',
                    'lib.ets': 'export const value=1;'}),
    'type-only': (1, {'main.ets': 'import type * as ns from "./lib"; print(ns.value);',
                      'lib.ets': 'export const value=1;'}),
    'queries': (0, {
        'main.ets': 'import * as ns from "./lib"; type Q=typeof ns.value; const o={value:2}; {const ns=o; print(ns.value);} print(ns.value);',
        'lib.ets': 'export const value=1;',
    }),
    'many-members': (0, {
        'main.ets': 'import * as ns from "./barrel";\n' + 'print(ns.inner.value);\n' * 256,
        'barrel.ets': 'export * as inner from "./lib";', 'lib.ets': 'export const value=1;',
    }),
}
report = {'binaries': {}, 'cases': []}
for label, binary in [('baseline', args.baseline), ('candidate', args.candidate)]:
    report['binaries'][label] = dict(path=str(binary.resolve()),
        sha256=hashlib.sha256(binary.read_bytes()).hexdigest())
for name, (status, files) in cases.items():
    directory = output / name
    directory.mkdir()
    for path, content in files.items():
        (directory / path).write_text(content)
    results = []
    for label, binary in [('baseline', args.baseline), ('candidate', args.candidate)]:
        result = subprocess.run([str(binary.resolve()), str(directory / 'main.ets')],
                                capture_output=True, timeout=120)
        (directory / (label + '.json')).write_bytes(result.stdout)
        (directory / (label + '.trace')).write_bytes(result.stderr)
        assert result.returncode == status, (name, label, result.returncode, result.stderr[-2000:])
        results.append(json.loads(result.stdout))
    assert results[0] == results[1], name + ': binding output changed'
    report['cases'].append(dict(name=name, exitCode=status, identical=True,
        references=len(results[1]['references']), diagnostics=len(results[1]['diagnostics'])))
    print(name + ': identical bindings and diagnostics', flush=True)
(output / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')
