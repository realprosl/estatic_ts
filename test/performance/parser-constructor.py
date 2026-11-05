#!/usr/bin/env python3
"""CI-only timing harness: constructor phases, indexed scan, CPU and peak RSS."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

out = Path('build/selfhost/constructor-regression')
out.mkdir(parents=True, exist_ok=True)
rows = []
for size in (1000, 2000, 4000, 8000, 16000, 20208):
    starts, elapsed = {}, {}
    log = []
    command = ['/usr/bin/time', '-f', 'RESOURCE elapsed=%e user=%U sys=%S max_rss_kb=%M',
               'timeout', '--kill-after=5s', '40s', sys.argv[1],
               str(Path('bootstrap/parser/parser.ets').resolve()), str(size)]
    with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, bufsize=1) as proc:
        tokens = None
        for line in proc.stderr:
            now = time.perf_counter()
            log.append(line)
            print(line, end='', flush=True)
            parts = line.split()
            if parts[:1] == ['TOKENS']:
                tokens = int(parts[1])
            if len(parts) == 3 and parts[0] in ('BENCH', 'PHASE'):
                key = parts[1]
                if parts[2] == 'BEGIN': starts[key] = now
                elif parts[2] == 'END': elapsed[key] = elapsed.get(key, 0) + now - starts.pop(key)
        code = proc.wait()
    (out / f'tokens-{size}.log').write_text(''.join(log))
    if code: raise SystemExit(f'benchmark {size} failed: {code}')
    assert tokens == size + 1, (size, tokens)
    assert not starts, starts
    for key in ('constructor', 'indexed', 'eof', 'validation'):
        assert key in elapsed, key
        elapsed[key] /= 20
    rows.append(dict(tokens=tokens, **elapsed, resource=next(x.strip() for x in log if x.startswith('RESOURCE'))))
(out / 'timings.json').write_text(json.dumps(rows, indent=2))
# A deterministic IR regression accompanies this deliberately generous timing
# guard. An additive floor avoids failures for sub-millisecond scheduler noise.
for key in ('constructor', 'indexed'):
    small, large = rows[2][key], rows[4][key]
    assert large <= small * 8 + 0.02, (key, small, large)
summary = '| Tokens | Constructor (s) | EOF (s) | Validation (s) | Indexed (s) | CPU / RSS (whole process) |\n|---:|---:|---:|---:|---:|---|\n'
for r in rows:
    summary += f'| {r["tokens"]} | {r["constructor"]:.6f} | {r["eof"]:.6f} | {r["validation"]:.6f} | {r["indexed"]:.6f} | {r["resource"]} |\n'
print(summary)
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
    f.write('Constructor and indexed scan: mean of 20 trials, valid tokens, zero diagnostics.\n\n' + summary)
