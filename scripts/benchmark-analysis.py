#!/usr/bin/env python3
"""Paired native source-to-IR measurements; never substitutes another compiler."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import statistics
import subprocess
import time


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def workload():
    # Mutable parameters keep contextual callee checking active. No execution of
    # these functions is necessary: every definition must still be checked.
    source = "class Cell{value:number=1;}\n"
    source += "function touch(out cell:Cell):number{" + "cell.value+=1;" * 16 + "return cell.value;}\n"
    for index in range(48):
        source += f"function work{index}(out cell:Cell):number{{\n"
        source += "touch(cell);\n" * 32
        source += "return cell.value;}\n"
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--entry", type=Path)
    parser.add_argument("--repetitions", type=int, default=3)
    args = parser.parse_args()
    if args.repetitions < 2:
        parser.error("Use at least two paired repetitions")
    root = Path(__file__).resolve().parent.parent
    compiler = args.compiler.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    entry = args.entry.resolve(strict=True) if args.entry else output / "workload.ets"
    if not args.entry:
        entry.write_text(workload())
    env = {**os.environ, "ESTC_ROOT": str(root)}
    cache = output / "syntax-cache"
    metadata = {
        "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "tracked_changes_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD", "--"], cwd=root)).hexdigest(),
        "compiler": str(compiler), "compiler_sha256": sha256(compiler),
        "entry": str(entry), "entry_sha256": sha256(entry),
        "platform": platform.platform(), "cpu_count": os.cpu_count(),
        "cpu_affinity": sorted(os.sched_getaffinity(0)),
        "optimization": env.get("ESTATIC_ETS_OPTIMIZATION", "unspecified"),
        "cxx": subprocess.check_output([env.get("CXX", "g++"), "--version"], text=True).splitlines()[0],
        "cache": "warm syntax cache; semantic analysis runs in every fresh process",
        "rss": "wait4 maximum resident set of one process (KiB on Linux), not aggregate process-tree RSS",
        "repetitions": args.repetitions, "jobs": [1, 2],
    }
    for quota in [Path("/sys/fs/cgroup/cpu.max"), Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")]:
        if quota.exists():
            metadata[str(quota)] = quota.read_text().strip()
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    reference_hash = None
    rows = []
    # Warm the same syntax cache for both modes, then alternate order to reduce
    # bias from caches, runner load and temperature. No timing asserts in CI.
    for repetition in range(-1, args.repetitions):
        for jobs in ([1, 2] if repetition % 2 == 0 else [2, 1]):
            name = f"repeat-{repetition}-jobs-{jobs}"
            ir = output / (name + ".ir.json")
            command = [str(compiler), str(entry), "--check", "--no-progress",
                       "--jobs", str(jobs), "--profile-analysis", "--cache", str(cache),
                       "--emit-ir", str(ir)]
            with (output / (name + ".log")).open("w") as log:
                begin = time.monotonic()
                process = subprocess.Popen(command, env=env, cwd=root, stdout=log, stderr=log)
                _, status, usage = os.wait4(process.pid, 0)
                process.returncode = os.waitstatus_to_exitcode(status)
                wall = time.monotonic() - begin
            if process.returncode:
                raise RuntimeError(f"{command!r} failed ({process.returncode}); see {name}.log")
            digest = sha256(ir)
            if reference_hash is None:
                reference_hash = digest
            if digest != reference_hash:
                raise RuntimeError(f"Verified IR differs: {name}")
            if repetition >= 0:
                phases = {}
                for line in (output / (name + ".log")).read_text().splitlines():
                    match = re.match(r"frontend: profile ([\w-]+) (.*)", line)
                    if match:
                        phases.setdefault(match[1], []).append({
                            key: float(value) for key, value in
                            re.findall(r"(\w+)=([-+\d.eE]+)", match[2])})
                rows.append({"repetition": repetition + 1, "jobs": jobs,
                             "wall_seconds": wall, "user_seconds": usage.ru_utime,
                             "system_seconds": usage.ru_stime, "peak_process_rss_kib": usage.ru_maxrss,
                             "ir_sha256": digest, "command": command, "phases": phases})
            ir.unlink()
    (output / "samples.json").write_text(json.dumps(rows, indent=2) + "\n")
    summary = []
    for jobs in [1, 2]:
        samples = [row for row in rows if row["jobs"] == jobs]
        walls = [row["wall_seconds"] for row in samples]
        flow = [row["phases"]["flow-definitions"][0]["wall_ms"] for row in samples]
        summary.append({"jobs": jobs, "median_wall_seconds": statistics.median(walls),
                        "min_wall_seconds": min(walls), "max_wall_seconds": max(walls),
                        "stdev_wall_seconds": statistics.stdev(walls),
                        "median_cpu_seconds": statistics.median(row["user_seconds"] + row["system_seconds"] for row in samples),
                        "median_flow_wall_ms": statistics.median(flow),
                        "min_flow_wall_ms": min(flow), "max_flow_wall_ms": max(flow),
                        "max_process_rss_kib": max(row["peak_process_rss_kib"] for row in samples)})
    result = {"measurements": summary,
              "median_speedup": summary[0]["median_wall_seconds"] / summary[1]["median_wall_seconds"]}
    (output / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
