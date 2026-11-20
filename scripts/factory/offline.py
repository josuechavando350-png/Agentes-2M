"""Run the exam with IPv4/IPv6 socket creation denied for this process and its children."""
import ctypes as C
import ctypes.util
import errno
import os
import socket
import sys


class Match(C.Structure):
    _fields_ = [("arg", C.c_uint), ("op", C.c_uint), ("a", C.c_uint64), ("b", C.c_uint64)]


lib = C.CDLL(ctypes.util.find_library("seccomp") or "libseccomp.so.2")
lib.seccomp_init.argtypes = [C.c_uint32]
lib.seccomp_init.restype = C.c_void_p
lib.seccomp_rule_add_array.argtypes = [C.c_void_p, C.c_uint32, C.c_int, C.c_uint, C.POINTER(Match)]
lib.seccomp_load.argtypes = [C.c_void_p]
lib.seccomp_release.argtypes = [C.c_void_p]
lib.seccomp_syscall_resolve_name.argtypes = [C.c_char_p]
ctx = lib.seccomp_init(0x7fff0000)
if not ctx:
    raise RuntimeError("seccomp_init")
nr = lib.seccomp_syscall_resolve_name(b"socket")
for family in (socket.AF_INET, socket.AF_INET6):
    if lib.seccomp_rule_add_array(ctx, 0x50000 | errno.EPERM, nr, 1, C.byref(Match(0, 4, family, 0))):
        raise RuntimeError("seccomp_rule_add_array")
if lib.seccomp_load(ctx):
    raise RuntimeError("seccomp_load")
lib.seccomp_release(ctx)
for family in (socket.AF_INET, socket.AF_INET6):
    try:
        with socket.socket(family):
            raise RuntimeError("Network denial unavailable")
    except PermissionError as error:
        if error.errno != errno.EPERM:
            raise
os.execvp(sys.argv[1], sys.argv[1:])
