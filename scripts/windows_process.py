"""Windows process ownership and private directories using only OS APIs.

Children start suspended and enter a kill-on-close Job Object before any child
code executes. This module is imported only on Windows. Filesystem checks detect
observed reparse points; they are not an atomic no-follow filesystem sandbox.
"""
import ctypes
from ctypes import wintypes
import msvcrt
import os
from pathlib import Path
import subprocess
import time

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
advapi = ctypes.WinDLL('advapi32', use_last_error=True)
SIZE_T = ctypes.c_size_t
HANDLE = wintypes.HANDLE
INVALID_HANDLE = ctypes.c_void_p(-1).value


class STARTUPINFO(ctypes.Structure):
    _fields_ = [('cb', wintypes.DWORD), ('lpReserved', wintypes.LPWSTR),
                ('lpDesktop', wintypes.LPWSTR), ('lpTitle', wintypes.LPWSTR),
                ('dwX', wintypes.DWORD), ('dwY', wintypes.DWORD),
                ('dwXSize', wintypes.DWORD), ('dwYSize', wintypes.DWORD),
                ('dwXCountChars', wintypes.DWORD), ('dwYCountChars', wintypes.DWORD),
                ('dwFillAttribute', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                ('wShowWindow', wintypes.WORD), ('cbReserved2', wintypes.WORD),
                ('lpReserved2', ctypes.POINTER(wintypes.BYTE)),
                ('hStdInput', HANDLE), ('hStdOutput', HANDLE), ('hStdError', HANDLE)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [('hProcess', HANDLE), ('hThread', HANDLE),
                ('dwProcessId', wintypes.DWORD), ('dwThreadId', wintypes.DWORD)]


class STARTUPINFOEX(ctypes.Structure):
    _fields_ = [('StartupInfo', STARTUPINFO), ('lpAttributeList', ctypes.c_void_p)]


class BASIC_LIMIT(ctypes.Structure):
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong),
                ('PerJobUserTimeLimit', ctypes.c_longlong), ('LimitFlags', wintypes.DWORD),
                ('MinimumWorkingSetSize', SIZE_T), ('MaximumWorkingSetSize', SIZE_T),
                ('ActiveProcessLimit', wintypes.DWORD), ('Affinity', SIZE_T),
                ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in
                ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]


class EXTENDED_LIMIT(ctypes.Structure):
    _fields_ = [('BasicLimitInformation', BASIC_LIMIT), ('IoInfo', IO_COUNTERS),
                ('ProcessMemoryLimit', SIZE_T), ('JobMemoryLimit', SIZE_T),
                ('PeakProcessMemoryUsed', SIZE_T), ('PeakJobMemoryUsed', SIZE_T)]


class ACCOUNTING(ctypes.Structure):
    _fields_ = [('TotalUserTime', ctypes.c_longlong), ('TotalKernelTime', ctypes.c_longlong),
                ('ThisPeriodTotalUserTime', ctypes.c_longlong), ('ThisPeriodTotalKernelTime', ctypes.c_longlong),
                ('TotalPageFaultCount', wintypes.DWORD), ('TotalProcesses', wintypes.DWORD),
                ('ActiveProcesses', wintypes.DWORD), ('TotalTerminatedProcesses', wintypes.DWORD)]


def bind(library, name, result, arguments):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = arguments
    return function


close_handle = bind(kernel, 'CloseHandle', wintypes.BOOL, [HANDLE])
create_job = bind(kernel, 'CreateJobObjectW', HANDLE, [ctypes.c_void_p, wintypes.LPCWSTR])
set_job = bind(kernel, 'SetInformationJobObject', wintypes.BOOL, [HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD])
query_job = bind(kernel, 'QueryInformationJobObject', wintypes.BOOL, [HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p])
assign_job = bind(kernel, 'AssignProcessToJobObject', wintypes.BOOL, [HANDLE, HANDLE])
terminate_job = bind(kernel, 'TerminateJobObject', wintypes.BOOL, [HANDLE, wintypes.UINT])
terminate_process = bind(kernel, 'TerminateProcess', wintypes.BOOL, [HANDLE, wintypes.UINT])
resume_thread = bind(kernel, 'ResumeThread', wintypes.DWORD, [HANDLE])
wait_handle = bind(kernel, 'WaitForSingleObject', wintypes.DWORD, [HANDLE, wintypes.DWORD])
exit_code = bind(kernel, 'GetExitCodeProcess', wintypes.BOOL, [HANDLE, ctypes.POINTER(wintypes.DWORD)])
create_process = bind(kernel, 'CreateProcessW', wintypes.BOOL,
                      [wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p, ctypes.c_void_p,
                       wintypes.BOOL, wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR,
                       ctypes.POINTER(STARTUPINFO), ctypes.POINTER(PROCESS_INFORMATION)])
initialize_attributes = bind(kernel, 'InitializeProcThreadAttributeList', wintypes.BOOL,
                             [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(SIZE_T)])
update_attribute = bind(kernel, 'UpdateProcThreadAttribute', wintypes.BOOL,
                        [ctypes.c_void_p, wintypes.DWORD, SIZE_T, ctypes.c_void_p, SIZE_T, ctypes.c_void_p, ctypes.c_void_p])
delete_attributes = bind(kernel, 'DeleteProcThreadAttributeList', None, [ctypes.c_void_p])
get_attributes = bind(kernel, 'GetFileAttributesW', wintypes.DWORD, [wintypes.LPCWSTR])
local_free = bind(kernel, 'LocalFree', ctypes.c_void_p, [ctypes.c_void_p])


def checked(value):
    if not value:
        raise ctypes.WinError(ctypes.get_last_error())
    return value


def assert_no_reparse(path):
    current = Path(os.path.abspath(path))
    for item in (current, *current.parents):
        attributes = get_attributes(str(item))
        if attributes == 0xffffffff:
            raise ctypes.WinError(ctypes.get_last_error())
        if attributes & 0x400:
            raise ValueError('Reparse-point paths are not permitted: ' + str(item))


def current_sid():
    token = HANDLE()
    checked(bind(advapi, 'OpenProcessToken', wintypes.BOOL,
                 [HANDLE, wintypes.DWORD, ctypes.POINTER(HANDLE)])(
        bind(kernel, 'GetCurrentProcess', HANDLE, [])(), 8, ctypes.byref(token)))
    try:
        get_token = bind(advapi, 'GetTokenInformation', wintypes.BOOL,
                         [HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)])
        length = wintypes.DWORD()
        get_token(token, 1, None, 0, ctypes.byref(length))
        buffer = ctypes.create_string_buffer(length.value)
        checked(get_token(token, 1, buffer, length, ctypes.byref(length)))
        sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
        output = wintypes.LPWSTR()
        checked(bind(advapi, 'ConvertSidToStringSidW', wintypes.BOOL,
                     [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)])(sid, ctypes.byref(output)))
        try:
            return output.value
        finally:
            local_free(output)
    finally:
        close_handle(token)


def private_directory(path):
    """Replace this owned directory's DACL before writing private contents."""
    path = Path(path)
    ancestor = path
    while not ancestor.exists():
        ancestor = ancestor.parent
    assert_no_reparse(ancestor)
    path.mkdir(parents=True, exist_ok=True)
    assert_no_reparse(path)
    descriptor = ctypes.c_void_p()
    sddl = 'D:P(A;OICI;FA;;;' + current_sid() + ')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'
    checked(bind(advapi, 'ConvertStringSecurityDescriptorToSecurityDescriptorW', wintypes.BOOL,
                 [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p])(
        sddl, 1, ctypes.byref(descriptor), None))
    try:
        present, defaulted, dacl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        checked(bind(advapi, 'GetSecurityDescriptorDacl', wintypes.BOOL,
                     [ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL)])(
            descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)))
        result = bind(advapi, 'SetNamedSecurityInfoW', wintypes.DWORD,
                      [wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p])(
            str(path), 1, 0x80000004, None, None, dacl, None)
        if result:
            raise ctypes.WinError(result)
    finally:
        local_free(descriptor)


class OwnedProcess:
    def __init__(self, command, cwd, env, stream):
        self.command, self.job, self.process = command, None, None
        info = PROCESS_INFORMATION()
        try:
            self.job = checked(create_job(None, None))
            limits = EXTENDED_LIMIT()
            limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
            checked(set_job(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
            # Python descriptors are non-inheritable by default. Only these
            # dedicated input/log handles are marked inheritable for creation.
            with open(os.devnull, 'rb') as stdin:
                input_handle = msvcrt.get_osfhandle(stdin.fileno())
                log_handle = msvcrt.get_osfhandle(stream.fileno())
                os.set_handle_inheritable(input_handle, True)
                os.set_handle_inheritable(log_handle, True)
                startup = STARTUPINFOEX()
                startup.StartupInfo.cb = ctypes.sizeof(startup)
                startup.StartupInfo.dwFlags = 0x100  # STARTF_USESTDHANDLES
                startup.StartupInfo.hStdInput, startup.StartupInfo.hStdOutput, startup.StartupInfo.hStdError = input_handle, log_handle, log_handle
                attribute_size = SIZE_T()
                initialize_attributes(None, 1, 0, ctypes.byref(attribute_size))
                attribute_buffer = ctypes.create_string_buffer(attribute_size.value)
                startup.lpAttributeList = ctypes.cast(attribute_buffer, ctypes.c_void_p)
                attributes_ready = False
                environment = ctypes.create_unicode_buffer('\0'.join(key + '=' + str(value) for key, value in sorted(env.items(), key=lambda item: item[0].upper())) + '\0\0')
                try:
                    checked(initialize_attributes(startup.lpAttributeList, 1, 0, ctypes.byref(attribute_size)))
                    attributes_ready = True
                    handles = (HANDLE * 2)(input_handle, log_handle)
                    checked(update_attribute(startup.lpAttributeList, 0, 0x20002, handles, ctypes.sizeof(handles), None, None))
                    checked(create_process(str(command[0]), ctypes.create_unicode_buffer(subprocess.list2cmdline(command)),
                                           None, None, True, 0x08080404, environment, str(cwd),
                                           ctypes.byref(startup.StartupInfo), ctypes.byref(info)))  # NO_WINDOW | EXTENDED_STARTUPINFO | UNICODE_ENV | SUSPENDED
                    self.process, self.pid = info.hProcess, info.dwProcessId
                finally:
                    if attributes_ready:
                        delete_attributes(startup.lpAttributeList)
                    os.set_handle_inheritable(log_handle, False)
                    os.set_handle_inheritable(input_handle, False)
            self.process, self.pid = info.hProcess, info.dwProcessId
            checked(assign_job(self.job, self.process))
            if resume_thread(info.hThread) == 0xffffffff:
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            if info.hProcess:
                terminate_process(info.hProcess, 1)
                wait_handle(info.hProcess, 10000)
            self.close()
            raise
        finally:
            if info.hThread:
                close_handle(info.hThread)

    def wait(self, timeout):
        deadline = time.monotonic() + timeout
        while True:
            result = wait_handle(self.process, 50)
            if result == 0:
                code = wintypes.DWORD()
                checked(exit_code(self.process, ctypes.byref(code)))
                return code.value
            if result == 0xffffffff:
                raise ctypes.WinError(ctypes.get_last_error())
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(self.command, timeout)

    def close(self):
        try:
            if self.job:
                try:
                    checked(terminate_job(self.job, 1))
                    if self.process and wait_handle(self.process, 10000) != 0:
                        raise RuntimeError('Windows owned process did not terminate within 10 seconds')
                    deadline = time.monotonic() + 10
                    while True:
                        counts = ACCOUNTING()
                        checked(query_job(self.job, 1, ctypes.byref(counts), ctypes.sizeof(counts), None))
                        if counts.ActiveProcesses == 0:
                            break
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Windows job processes did not terminate within 10 seconds')
                        time.sleep(0.05)
                finally:
                    close_handle(self.job)
                    self.job = None
        finally:
            if self.process:
                close_handle(self.process)
                self.process = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
