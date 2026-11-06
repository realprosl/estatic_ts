#!/usr/bin/env python3
"""Time native analysis trace arrivals without changing compiler semantics (Linux)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import selectors
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", required=True, type=Path)
    parser.add_argument("--entry", default="bootstrap/ir/demo.ets")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout", default=300, type=int)
    parser.add_argument("--frontend-source-commit", required=True)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    executable = args.frontend.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    context = {
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "sourceDirty": bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"])),
        "frontendSourceCommit": args.frontend_source_commit,
        "frontend": str(executable),
        "frontendSha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "entry": args.entry,
        "timeoutSeconds": args.timeout,
        "platform": platform.platform(),
        "timing": "monotonic stderr arrival times; includes pipe and scheduling latency",
    }
    command = ["timeout", "--signal=TERM", "--kill-after=10s", str(args.timeout) + "s",
               str(executable), args.entry, "--trace"]
    context["command"] = command
    (output / "context.json").write_text(json.dumps(context, indent=2) + "\n")
    pattern = re.compile(rb"^TRACE (\S+) (BEGIN|END|POINT)$")
    events, phases, opened = [], [], []
    started = time.monotonic()

    def receive(line):
        match = pattern.fullmatch(line.rstrip(b"\r\n"))
        if not match:
            return
        phase, kind = (part.decode() for part in match.groups())
        elapsed = time.monotonic() - started
        event = dict(seconds=elapsed, phase=phase, kind=kind)
        events.append(event)
        event_file.write(json.dumps(event) + "\n")
        event_file.flush()
        if kind == "BEGIN":
            opened.append(event)
        elif kind == "END":
            if not opened or opened[-1]["phase"] != phase:
                raise RuntimeError("Unbalanced trace: " + phase)
            begin = opened.pop()
            phases.append(dict(phase=phase, startSeconds=begin["seconds"],
                               endSeconds=elapsed, durationSeconds=elapsed - begin["seconds"]))

    with (output / "ir.stdout").open("wb") as stdout, \
         (output / "trace.stderr").open("wb") as stderr, \
         (output / "trace-events.jsonl").open("w") as event_file:
        process = subprocess.Popen(command, stdout=stdout, stderr=subprocess.PIPE)
        pending = b""
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stderr, selectors.EVENT_READ)
                eof = False
                while not eof:
                    for key, _ in selector.select(timeout=1):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            eof = True
                            break
                        stderr.write(chunk)
                        stderr.flush()
                        pending += chunk
                        while b"\n" in pending:
                            line, pending = pending.split(b"\n", 1)
                            receive(line)
                if pending:
                    receive(pending)
            _, status, usage = os.wait4(process.pid, 0)
            code = os.waitstatus_to_exitcode(status)
            process.returncode = code
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            process.stderr.close()
    duration = time.monotonic() - started
    resources = dict(userSeconds=usage.ru_utime, systemSeconds=usage.ru_stime,
                     maxRssKiB=usage.ru_maxrss,
                     cpuPercent=100 * (usage.ru_utime + usage.ru_stime) / duration,
                     scope="timeout process and reaped frontend child; Linux wait4")
    (output / "resources.json").write_text(json.dumps(resources, indent=2) + "\n")
    summary = dict(exitCode=code, timedOut=code == 124, killed=code in (137, -9),
                   timeoutMayHaveKilled=code in (137, -9) and duration >= args.timeout,
                   elapsedSeconds=duration,
                   traceEvents=len(events), completedPhases=phases,
                   openPhases=[dict(phase=e["phase"], startSeconds=e["seconds"],
                                    observedSeconds=duration - e["seconds"]) for e in opened])
    # Open intervals are lower bounds, not completed phase durations.
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (output / "exit-code.txt").write_text(str(code) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "completedPhases"}, indent=2))
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main())
