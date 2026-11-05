#!/usr/bin/env python3
"""Build and measure the native Parser constructor (issue #60), without Node."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parent.parent


def measure(binary, size, mode, output):
    started = time.perf_counter()
    process = subprocess.Popen(
        [str(binary), str(ROOT / "bootstrap/parser/parser.ets"), str(size), mode],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, cwd=ROOT)
    timer = threading.Timer(40, process.kill)
    timer.start()
    marks, lines = {}, []
    try:
        for line in process.stderr:
            now = time.perf_counter()
            lines.append(line)
            if line.startswith("BENCH "):
                key = line.split(" tokens=", 1)[0].strip()[6:]
                marks[key] = now
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
    finally:
        timer.cancel()
    (output / f"{mode}-{size}.log").write_text("".join(lines))
    if process.returncode or f"{mode} END" not in marks:
        raise RuntimeError(f"{mode}/{size}: exit {process.returncode}; see {output}")
    if not any(f"BENCH {mode} END tokens={size + 1} " in line for line in lines):
        raise RuntimeError("Source has fewer tokens than the requested sample")
    if mode == "constructor" and "diagnostics=0" not in "".join(lines):
        raise RuntimeError("Valid tokens produced diagnostics")
    result = dict(mode=mode, tokens=size + 1,
                  seconds=marks[f"{mode} END"] - marks[f"{mode} BEGIN"],
                  elapsed=time.perf_counter() - started, cpu=usage.ru_utime + usage.ru_stime,
                  max_rss_kb=usage.ru_maxrss)
    if mode == "constructor":
        for phase in ("eof", "coordinates"):
            result[phase + "_seconds"] = marks[phase + " END"] - marks[phase + " BEGIN"]
    print(json.dumps(result), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", type=Path, default=ROOT / "native-compiler-mini/native/etsc")
    parser.add_argument("--output", type=Path, default=ROOT / "build/selfhost/constructor-bench")
    parser.add_argument("--sizes", nargs="+", type=int, default=[1000, 2000, 4000, 8000, 16000, 20208])
    args = parser.parse_args()
    if any(size <= 0 for size in args.sizes):
        parser.error("Sample sizes must be positive")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Separate instrumented module: production constructor and its validation stay unchanged.
    instrumented = ROOT / "bootstrap/parser/constructor-bench-parser.ets"
    driver = ROOT / "bootstrap/ir/constructor-bench-driver.ets"
    if instrumented.exists() or driver.exists():
        raise RuntimeError("Benchmark temporary source already exists")
    source = (ROOT / "bootstrap/parser/parser.ets").read_text()
    anchors = [
        ('    for (let i: number = 0; i + 1 < this.tokens.length; i = i + 1) {',
         '    printError("BENCH eof BEGIN");\n    for (let i: number = 0; i + 1 < this.tokens.length; i = i + 1) {'),
        ('    for (let i: number = 0; i < this.tokens.length; i = i + 1) {',
         '    printError("BENCH eof END"); printError("BENCH coordinates BEGIN");\n    for (let i: number = 0; i < this.tokens.length; i = i + 1) {'),
        ('  coordinate(value: number, minimum: number): boolean {',
         '  coordinate(value: number, minimum: number): boolean {')]
    for old, new in anchors:
        if source.count(old) != 1:
            raise RuntimeError(f"Non-unique instrumentation anchor: {old}")
        source = source.replace(old, new)
    end = '    }\n  }\n  coordinate(value:'
    if source.count(end) != 1:
        raise RuntimeError("Missing constructor end")
    source = source.replace(end, '    }\n    printError("BENCH coordinates END");\n  }\n  coordinate(value:')
    bench = (ROOT / "bootstrap/ir/constructor-bench.ets").read_text()
    bench = bench.replace('../parser/parser"', '../parser/constructor-bench-parser"')
    try:
        instrumented.write_text(source)
        driver.write_text(bench)
        env = {**os.environ, "ESTC_ROOT": str(args.compiler.resolve().parent.parent)}
        subprocess.run([str(args.compiler.resolve()), "build", str(driver), "-o", str(output / "bench.cpp"),
                        "--binary", str(output / "bench"), "--no-progress"],
                       cwd=ROOT, env=env, check=True, timeout=180)
    finally:
        instrumented.unlink(missing_ok=True)
        driver.unlink(missing_ok=True)
    results = []
    for size in args.sizes:
        for mode in ("length", "index", "constructor"):
            results.append(measure(output / "bench", size, mode, output))
            (output / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    constructors = {r["tokens"]: r["seconds"] for r in results if r["mode"] == "constructor"}
    # A noise floor avoids flaky ratios for millisecond runs; the 40s deadline
    # and the structural IR test also catch reintroduced whole-array loads.
    for small, large in ((8001, 16001), (4001, 8001)):
        if small in constructors and large in constructors:
            if constructors[large] > max(0.1, 3.5 * constructors[small]):
                raise RuntimeError(f"Superlinear constructor scaling: {small} -> {large}")


if __name__ == "__main__":
    main()
