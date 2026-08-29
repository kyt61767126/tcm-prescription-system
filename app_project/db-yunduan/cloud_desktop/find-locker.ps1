$src = @"
using System;
using System.Runtime.InteropServices;

public static class FileLockFinder
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
        public int ApplicationType; public uint AppStatus; public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint pSessionHandle, int SessionFlags, string strSessionKey);
    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    public static string[] FindLockers(string path)
    {
        uint handle;
        string key = Guid.NewGuid().ToString();
        int res = RmStartSession(out handle, 0, key);
        if (res != 0) throw new Exception("RmStartSession failed: " + res);
        try
        {
            string[] resources = new string[] { path };
            res = RmRegisterResources(handle, 1, resources, 0, null, 0, null);
            if (res != 0) throw new Exception("RmRegisterResources failed: " + res);
            uint needed = 0, count = 10, reasons = 0;
            RM_PROCESS_INFO[] info = new RM_PROCESS_INFO[count];
            res = RmGetList(handle, out needed, ref count, info, ref reasons);
            if (res == 234) { info = new RM_PROCESS_INFO[needed]; count = needed; res = RmGetList(handle, out needed, ref count, info, ref reasons); }
            if (res != 0) throw new Exception("RmGetList failed: " + res);
            var names = new string[count];
            for (int i = 0; i < count; i++) names[i] = info[i].Process.dwProcessId + ": " + info[i].strAppName;
            return names;
        }
        finally { RmEndSession(handle); }
    }
}
"@
Add-Type -TypeDefinition $src
$lockers = [FileLockFinder]::FindLockers('D:\trae_projects\kyt-zy\app_project\db-yunduan\cloud_desktop\dist\win-unpacked\resources\app.asar')
if ($lockers.Count -eq 0) { 'NO LOCKERS FOUND (lock may have been released)' }
$lockers | ForEach-Object { $_ }
