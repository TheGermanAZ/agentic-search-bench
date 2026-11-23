"""Prints the summed macOS phys_footprint (MB) of a process tree every 100 ms, one number per line.
RSS misses memory the kernel has compressed; phys_footprint (what Activity Monitor calls Memory) does not.
Usage: python3 footprint.py <root-pid>   (exits when the root process is gone)"""
import ctypes
import os
import subprocess
import sys
import time

libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
RUSAGE_INFO_V2 = 2


class RUsageV2(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [(n, ctypes.c_uint64) for n in (
        "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups", "pageins", "wired_size", "resident_size",
        "phys_footprint", "proc_start_abstime", "proc_exit_abstime", "child_user_time", "child_system_time",
        "child_pkg_idle_wkups", "child_interrupt_wkups", "child_pageins", "child_elapsed_abstime",
        "diskio_bytesread", "diskio_byteswritten")]


def footprint(pid):
    buf = RUsageV2()
    return buf.phys_footprint if libc.proc_pid_rusage(pid, RUSAGE_INFO_V2, ctypes.byref(buf)) == 0 else 0


def tree(root):
    rows = subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True).stdout.split("\n")
    kids = {}
    for r in rows:
        p = r.split()
        if len(p) == 2:
            kids.setdefault(int(p[1]), []).append(int(p[0]))
    out, st = [], [root]
    while st:
        p = st.pop()
        out.append(p)
        st.extend(kids.get(p, []))
    return out


root = int(sys.argv[1])
while True:
    try:
        os.kill(root, 0)
    except OSError:
        break
    print(round(sum(footprint(p) for p in tree(root)) / 1048576), flush=True)
    time.sleep(0.1)
