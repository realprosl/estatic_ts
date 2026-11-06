#!/usr/bin/env python3
"""Verify a second native frontend generation, including IR, C++, link and control."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', required=True, type=Path)
    parser.add_argument('--seed-source-commit', required=True)
    parser.add_argument('--target-source-commit', required=True)
    parser.add_argument('--compiler', required=True, type=Path)
    parser.add_argument('--native-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    frontend = args.frontend.resolve(strict=True)
    compiler = args.compiler.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ, ESTC_ROOT=str(args.native_root.resolve(strict=True)))
    report = dict(success=False, seedSourceCommit=args.seed_source_commit,
                  targetSourceCommit=args.target_source_commit,
                  checkoutCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
                  checkoutDirty=bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root)),
                  frontendSha256=digest(frontend), backendSha256=digest(compiler),
                  compilerFlags=['-std=c++20', '-O1', '-pthread', '-fno-exceptions'],
                  analysisTimeoutSeconds=300, buildTimeoutSeconds=600,
                  backend='C++ reference backend; only the frontend is regenerated', steps=[])

    def save():
        (output / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')

    def run(label, command, timeout=600):
        step = dict(label=label, command=[str(arg) for arg in command])
        report['steps'].append(step)
        save()
        print(label + ': BEGIN', flush=True)
        started = time.monotonic()
        with (output / (label + '.stdout')).open('wb') as stdout, \
             (output / (label + '.stderr')).open('wb') as stderr:
            result = subprocess.run(['timeout', '--signal=TERM', '--kill-after=10s', str(timeout) + 's',
                                     *step['command']], cwd=root, env=env, stdout=stdout, stderr=stderr)
        step.update(exitCode=result.returncode, seconds=time.monotonic() - started)
        save()
        print(label + ': exit=' + str(result.returncode), flush=True)
        if result.returncode:
            raise subprocess.CalledProcessError(result.returncode, command)

    def profile(label, binary, entry, source_commit):
        run(label, [sys.executable, root / 'scripts/profile-analyze-project.py',
                    '--frontend', binary, '--frontend-source-commit', source_commit,
                    '--entry', entry, '--output', output / label], timeout=320)
        ir = output / label / 'ir.stdout'
        with ir.open() as stream:
            project = json.load(stream)
        if project.get('success') is not True or project.get('diagnostics') != []:
            raise ValueError(label + ': IR must have success=true and no diagnostics')
        report[label] = dict(irSha256=digest(ir), irBytes=ir.stat().st_size,
                             functions=len(project.get('functions', [])))
        save()
        return ir

    try:
        ir = profile('second-generation-ir', frontend, 'bootstrap/ir/demo.ets', args.seed_source_commit)
        generated = output / 'frontend-gen2'
        run('build-second-generation', [compiler, 'build', '--from-ir', ir,
                                       '-o', output / 'frontend-gen2.cpp', '--binary', generated,
                                       '--cxx-flag', '-O1', '--no-progress'])
        report['secondGenerationSha256'] = digest(generated)
        repeated = profile('second-generation-self-ir', generated, 'bootstrap/ir/demo.ets', args.target_source_commit)
        if digest(ir) != digest(repeated):
            raise ValueError('Second generation changed its own frontend IR')
        report['selfIrIdentical'] = True
        control = profile('control-gen2', generated, 'examples/hello.ets', args.target_source_commit)
        original = profile('control-seed', frontend, 'examples/hello.ets', args.seed_source_commit)
        if digest(control) != digest(original):
            raise ValueError('Seed and second generation produced different control IR')
        executable = output / 'hello'
        run('build-control', [compiler, 'build', '--from-ir', control,
                              '-o', output / 'hello.cpp', '--binary', executable,
                              '--cxx-flag', '-O1', '--no-progress'])
        run('run-control', [executable], timeout=10)
        if (output / 'run-control.stdout').read_text().splitlines() != ['Hola, mundo', '120']:
            raise ValueError('Control output differs from the expected factorial result')
        report['success'] = True
        save()
        print('Second frontend generation verified, including control output.', flush=True)
        return 0
    except (subprocess.CalledProcessError, ValueError, OSError) as error:
        report['error'] = str(error)
        save()
        print('Verification incomplete: ' + str(error), file=sys.stderr, flush=True)
        return error.returncode if isinstance(error, subprocess.CalledProcessError) else 1


if __name__ == '__main__':
    sys.exit(main())
