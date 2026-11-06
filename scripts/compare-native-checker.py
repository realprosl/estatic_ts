#!/usr/bin/env python3
"""Require identical native IR/diagnostics before and after checker lookup changes."""
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
    'fields-and-shadowing': (0, {'main.ets': 'class C{field:number=1;read(field:string):number{print(field);return this.field;}} const c=new C();print(c.read("x"));'}),
    'constructor-property': (0, {'main.ets': 'class C{constructor(public value:number){} get():number{return this.value;}} print(new C(2).get());'}),
    'generic-fields': (0, {'main.ets': 'class Box<T>{constructor(public value:T){}} const b=new Box<number>(1);print(b.value);'}),
    'interface-fields': (0, {'main.ets': 'interface I{value:number;} const x:I={value:1};print(x.value);'}),
    'separate-modules': (0, {
        'main.ets': 'import {A} from "./a";import {B} from "./b";print(new A().value,new B().value);',
        'a.ets': 'export class A{value:number=1;}', 'b.ets': 'export class B{value:string="b";}',
    }),
    'missing-member': (1, {'main.ets': 'class C{value:number=1;}print(new C().missing);'}),
    'transitive-borrow-aliases': (0, {'main.ets': 'class Box{value:number=1;} function f():void{let b=new Box();const a=constRef(b);const c=a;const d=c;print(d.value);b.value=2;} f();'}),
    'write-through-live-alias': (1, {'main.ets': 'class Box{value:number=1;} function f():void{let b=new Box();const a=constRef(b);const c=a;const d=c;b.value=2;print(d.value);} f();'}),
    'async-default-at-creation': (0, {'main.ets': 'class B{}let p:ptr<B> = new B();async function f(x:ptr<B> = move(p)):Promise<void>{}const t=f();p=new B();const q=move(p);await t;'}),
}
report = dict(cases=[], binaries={})
for label, binary in [('baseline', args.baseline), ('candidate', args.candidate)]:
    report['binaries'][label] = dict(path=str(binary.resolve()),
        sha256=hashlib.sha256(binary.read_bytes()).hexdigest())
for name, (status, files) in cases.items():
    directory = output / name
    directory.mkdir()
    for path, text in files.items():
        (directory / path).write_text(text)
    values = []
    for label, binary in [('baseline', args.baseline), ('candidate', args.candidate)]:
        result = subprocess.run([str(binary.resolve()), str(directory / 'main.ets')], capture_output=True, timeout=60)
        (directory / (label + '.json')).write_bytes(result.stdout)
        (directory / (label + '.stderr')).write_bytes(result.stderr)
        assert result.returncode == status, (name, label, result.returncode, result.stderr, result.stdout[-3000:])
        values.append(json.loads(result.stdout))
    assert values[0] == values[1], name + ': native IR or diagnostics changed'
    assert values[1]['success'] == (status == 0)
    report['cases'].append(dict(name=name, identical=True, exitCode=status,
        diagnostics=len(values[1]['diagnostics'])))
    print(name + ': identical native IR and diagnostics', flush=True)
(output / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')
