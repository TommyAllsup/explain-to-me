// Compiled during setup with Windows' .NET Framework C# compiler. No shell is used.
// Remotion launches this executable as if it were Chrome. Chrome inherits its I/O
// handles, and a kill-on-close Job Object owns Chrome and all its descendants.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

internal static class WindowsBrowserLauncher
{
    private const uint StartfUseStdHandles = 0x100;
    private const uint CreateSuspended = 0x4;
    private const uint CreateNoWindow = 0x08000000;
    private const uint KillOnJobClose = 0x2000;
    private const uint Infinite = 0xffffffff;

    private static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        ProcessInformation child = new ProcessInformation();
        try
        {
            string configPath = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "renderer-chrome.config");
            string[] config = File.ReadAllLines(configPath, Encoding.UTF8);
            Uri proxy;
            if (config.Length != 2 || !Path.IsPathRooted(config[0]) || !File.Exists(config[0]) ||
                !Uri.TryCreate(config[1], UriKind.Absolute, out proxy) || proxy.Scheme != "http" ||
                proxy.Host != "127.0.0.1" || proxy.Port < 1 || proxy.AbsolutePath != "/" ||
                proxy.Query.Length != 0 || proxy.Fragment.Length != 0 || proxy.UserInfo.Length != 0)
                throw new InvalidOperationException("The renderer browser launcher configuration is invalid.");

            List<string> browserArgs = new List<string>();
            foreach (string arg in args)
            {
                if (arg == "--no-proxy-server" || arg == "--proxy-auto-detect" ||
                    arg.StartsWith("--proxy-server=", StringComparison.Ordinal) ||
                    arg.StartsWith("--proxy-pac-url=", StringComparison.Ordinal) ||
                    arg.StartsWith("--proxy-bypass-list=", StringComparison.Ordinal)) continue;
                browserArgs.Add(arg);
            }
            browserArgs.Add("--proxy-server=" + config[1]);
            browserArgs.Add("--proxy-bypass-list=<-loopback>");

            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero, "create browser job");
            JobExtendedLimitInformation limits = new JobExtendedLimitInformation();
            limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
            int limitsSize = Marshal.SizeOf(typeof(JobExtendedLimitInformation));
            IntPtr limitsPointer = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(limits, limitsPointer, false);
                Check(SetInformationJobObject(job, 9, limitsPointer, (uint)limitsSize), "configure browser job");
            }
            finally { Marshal.FreeHGlobal(limitsPointer); }

            StartupInfo startup = new StartupInfo();
            startup.cb = Marshal.SizeOf(typeof(StartupInfo));
            startup.dwFlags = StartfUseStdHandles;
            startup.hStdInput = InheritableStandardHandle(-10);
            startup.hStdOutput = InheritableStandardHandle(-11);
            startup.hStdError = InheritableStandardHandle(-12);
            StringBuilder commandLine = new StringBuilder(QuoteArgument(config[0]));
            foreach (string arg in browserArgs) commandLine.Append(' ').Append(QuoteArgument(arg));
            Check(CreateProcess(config[0], commandLine, IntPtr.Zero, IntPtr.Zero, true,
                CreateSuspended | CreateNoWindow, IntPtr.Zero, null, ref startup, out child), "start browser");
            // Suspend first so no browser subprocess can escape before job ownership.
            Check(AssignProcessToJobObject(job, child.hProcess), "assign browser job");
            Check(ResumeThread(child.hThread) != uint.MaxValue, "resume browser");
            Check(WaitForSingleObject(child.hProcess, Infinite) == 0, "wait for browser");
            uint code;
            Check(GetExitCodeProcess(child.hProcess, out code), "read browser exit status");
            return unchecked((int)code);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Windows renderer browser launcher: " + error.Message);
            if (child.hProcess != IntPtr.Zero) TerminateProcess(child.hProcess, 1);
            return 1;
        }
        finally
        {
            if (child.hThread != IntPtr.Zero) CloseHandle(child.hThread);
            if (child.hProcess != IntPtr.Zero) CloseHandle(child.hProcess);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    private static IntPtr InheritableStandardHandle(int identifier)
    {
        IntPtr handle = GetStdHandle(identifier);
        if (handle != IntPtr.Zero && handle != new IntPtr(-1))
            Check(SetHandleInformation(handle, 1, 1), "inherit browser standard I/O");
        return handle;
    }

    // Windows CommandLineToArgvW / C-runtime quoting: preserve empty strings,
    // embedded quotes, Unicode, and trailing backslashes without shell parsing.
    private static string QuoteArgument(string value)
    {
        StringBuilder quoted = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { backslashes++; continue; }
            if (character == '"') quoted.Append('\\', backslashes * 2 + 1).Append(character);
            else quoted.Append('\\', backslashes).Append(character);
            backslashes = 0;
        }
        quoted.Append('\\', backslashes * 2).Append('"');
        return quoted.ToString();
    }

    private static void Check(bool success, string operation)
    {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not " + operation);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { public IntPtr hProcess, hThread; public uint processId, threadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobBasicLimitInformation
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobExtendedLimitInformation
    {
        public JobBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startup, out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int identifier);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
}
