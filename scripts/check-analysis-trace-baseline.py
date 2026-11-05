#!/usr/bin/env python3
"""Run real suites and report existing failures explicitly; reject new failures.

The instrumentation contract is checked separately and must pass unconditionally.
Two stale baseline assertions are kept unchanged in this diagnostic-only PR.
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
new = set(head_result['failures']) - set(base_result['failures'])
report = dict(baseline=base_result, head=head_result, new_failures=sorted(new))
(evidence / 'suite-comparison.json').write_text(json.dumps(report, indent=2))
summary = f'''## Binder/checker baseline comparison

Full head suite: **{head_result['totals'].get('tests', '?')} tests**, {head_result['totals'].get('pass', '?')} passed, **{len(head_result['failures'])} failed**.

Baseline verification checks the two previously failing assertions on the PR base commit `{base_result['commit']}`. These assertions are not changed or skipped in the full head suite.

| Assertion | Base | Head |
| --- | --- | --- |
'''
for name in sorted(known):
    summary += f'| {name} | {"FAIL" if name in base_result["failures"] else "PASS"} | {"FAIL" if name in head_result["failures"] else "PASS"} |\n'
summary += f'\nNew failures relative to the base: **{len(new)}**. Raw TAP and JSON comparison are in the artifact. A green comparison means no additional failures, not that the original suite has zero failures.\n'
print(summary, flush=True)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
        f.write(summary)
assert not new, f'New failures: {sorted(new)}'
