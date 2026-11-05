#!/usr/bin/env python3
"""Verify old baseline assertions, then require the full head suite to pass.

The instrumentation contract is checked separately and must pass unconditionally.
The baseline keeps its old assertions. Head corrects their expectations without
changing Promise declarations or string.includes behavior.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

baseline = Path(sys.argv[1]).resolve()
evidence = Path(sys.argv[2]).resolve()
evidence.mkdir(parents=True, exist_ok=True)
known = {
    'binder: builtin declarations stay synchronized with canonical d.ts',
    'checker: string includes keeps the required offset parameter',
}


def run(label, cwd, selected):
    args = ['node', '--experimental-strip-types', '--test', '--test-concurrency=1']
    if selected:
        args.append('--test-name-pattern=builtin declarations stay synchronized with canonical d.ts|string includes keeps the required offset parameter')
    args += ['bootstrap/binder/binder.test.ts', 'bootstrap/checker/checker.test.ts']
    p = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, timeout=900)
    (evidence / f'{label}.tap').write_text(p.stdout)
    failures = set(re.findall(r'^not ok \d+ - (.+)$', p.stdout, re.MULTILINE))
    print(f'{label}: exit={p.returncode}; failed tests={sorted(failures)}', flush=True)
    assert p.returncode in (0, 1), p.stdout[-8000:]
    assert (p.returncode == 0) == (not failures), p.stdout[-8000:]
    assert 'hookFailed' not in p.stdout and 'testTimeoutFailure' not in p.stdout, p.stdout[-8000:]
    assert failures <= known, f'{label}: unexpected failures: {failures - known}\n{p.stdout[-8000:]}'
    totals = dict(re.findall(r'^# (tests|pass|fail|skipped) (\d+)$', p.stdout, re.MULTILINE))
    return dict(exit=p.returncode, failures=sorted(failures), totals=totals,
                commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip())


base_result = run('baseline-selected', baseline, True)
head_result = run('head-full', Path.cwd(), False)
new = set(head_result['failures'])
report = dict(baseline=base_result, head=head_result, new_failures=sorted(new))
(evidence / 'suite-comparison.json').write_text(json.dumps(report, indent=2))
summary = f'''## Binder/checker baseline comparison

Full head suite: **{head_result['totals'].get('tests', '?')} tests**, {head_result['totals'].get('pass', '?')} passed, **{len(head_result['failures'])} failed**.

Baseline verification checks the two old assertions on PR base commit `{base_result['commit']}`. The head suite fixes their expectations: Promise remains internal and absent from d.ts declarations, and string.includes accepts one or two arguments. No head tests are skipped or permitted to fail.

| Assertion | Base | Head |
| --- | --- | --- |
'''
for name in sorted(known):
    head_name = 'checker: string includes accepts an optional offset' if name.startswith('checker:') else name
    assert re.search(r'^ok \d+ - ' + re.escape(head_name) + r'$', (evidence / 'head-full.tap').read_text(), re.MULTILINE), head_name
    summary += f'| {name} | {"FAIL" if name in base_result["failures"] else "PASS"} | PASS (corrected expectation) |\n'
summary += f'\nFailing tests in the full head suite: **{len(new)}**. Raw TAP and JSON comparison are in the artifact. Green requires zero head failures.\n'
print(summary, flush=True)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
        f.write(summary)
assert not new, f'Full head suite failed: {sorted(new)}'
