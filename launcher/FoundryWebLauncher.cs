using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

internal sealed class FoundryWebLauncher : Form
{
    private const string AppTitle = "The Foundry Web";
    private const string ReadyPrefix = "FOUNDRY_READY ";
    private readonly Label status;
    private readonly Button openButton;
    private readonly System.Windows.Forms.Timer startupTimer;
    private Process server;
    private ServiceJob job;
    private Uri url;
    private volatile string lastError;
    private volatile bool stopping;

    [STAThread]
    private static void Main()
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        string instanceName;
        using (var sha = SHA256.Create())
            instanceName = "Local\\FoundryWeb-" + Convert.ToBase64String(
                sha.ComputeHash(Encoding.UTF8.GetBytes(folder.ToUpperInvariant())))
                .Replace('/', '_');

        bool firstInstance;
        using (var instance = new Mutex(true, instanceName, out firstInstance))
        {
            if (!firstInstance)
            {
                MessageBox.Show("The web launcher is already open. Use its Open in Browser button.",
                    AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new FoundryWebLauncher());
        }
    }

    private FoundryWebLauncher()
    {
        Text = AppTitle;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        ClientSize = new Size(460, 150);

        status = new Label {
            Location = new Point(16, 16), Size = new Size(428, 68),
            Text = "Starting the local server..."
        };
        openButton = new Button {
            Location = new Point(16, 98), Size = new Size(140, 32),
            Text = "Open in Browser", Enabled = false
        };
        openButton.Click += (sender, args) => OpenBrowser();
        var stopButton = new Button {
            Location = new Point(304, 98), Size = new Size(140, 32),
            Text = "Stop and Exit"
        };
        stopButton.Click += (sender, args) => Close();
        Controls.AddRange(new Control[] { status, openButton, stopButton });

        startupTimer = new System.Windows.Forms.Timer { Interval = 30000 };
        startupTimer.Tick += (sender, args) =>
            FailStartup("The local server did not start within 30 seconds.");
        Shown += (sender, args) => StartServer();
        FormClosed += (sender, args) =>
        {
            StopServer();
            startupTimer.Dispose();
        };
    }

    private void StartServer()
    {
        try
        {
            string folder = AppDomain.CurrentDomain.BaseDirectory;
            if (!File.Exists(Path.Combine(folder, "server", "launcher.js")) ||
                !File.Exists(Path.Combine(folder, "dist", "index.html")))
                throw new InvalidOperationException("Keep this launcher in the built Foundry web folder.");

            job = new ServiceJob();
            server = new Process {
                StartInfo = new ProcessStartInfo("node.exe", "server/launcher.js") {
                    WorkingDirectory = folder, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
                },
                EnableRaisingEvents = true
            };
            server.OutputDataReceived += (sender, args) =>
            {
                Uri address;
                if (args.Data != null && args.Data.StartsWith(ReadyPrefix, StringComparison.Ordinal) &&
                    Uri.TryCreate(args.Data.Substring(ReadyPrefix.Length), UriKind.Absolute, out address) &&
                    address.Scheme == Uri.UriSchemeHttp && address.Host == "127.0.0.1")
                    OnUi(() => ServerReady(address));
            };
            server.ErrorDataReceived += (sender, args) =>
            {
                if (!String.IsNullOrWhiteSpace(args.Data))
                    lastError = args.Data.Trim();
            };
            server.Exited += (sender, args) => OnUi(() =>
            {
                if (stopping) return;
                server.WaitForExit();
                FailStartup(lastError ?? "The local server exited. Close the launcher and try again.");
            });
            server.Start();
            try
            {
                job.Assign(server);
            }
            catch
            {
                if (!server.HasExited) server.Kill();
                throw;
            }
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            server.StandardInput.WriteLine("start");
            server.StandardInput.Close();
            startupTimer.Start();
        }
        catch (Win32Exception error)
        {
            FailStartup(error.NativeErrorCode == 2
                ? "Node.js was not found. Install Node.js 20.19 or later and reopen the launcher."
                : error.Message);
        }
        catch (Exception error)
        {
            FailStartup(error.Message);
        }
    }

    private void OnUi(Action action)
    {
        if (stopping) return;
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    private void ServerReady(Uri address)
    {
        if (stopping) return;
        startupTimer.Stop();
        url = address;
        status.Text = "Running at " + address + Environment.NewLine +
            "Leave this window open while using The Foundry.";
        openButton.Enabled = true;
        OpenBrowser();
    }

    private void OpenBrowser()
    {
        if (url == null) return;
        try
        {
            using (Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true })) { }
        }
        catch (Win32Exception)
        {
            status.Text = "Open this address in your browser: " + url;
        }
    }

    private void FailStartup(string message)
    {
        StopServer();
        status.Text = message;
        openButton.Enabled = false;
    }

    private void StopServer()
    {
        stopping = true;
        startupTimer.Stop();
        // Closing the last job handle stops the API and every process it started.
        if (job != null) job.Dispose();
        if (server != null) server.Dispose();
    }

    private sealed class ServiceJob : SafeHandleZeroOrMinusOneIsInvalid
    {
        private const uint KillOnJobClose = 0x2000;
        private const int ExtendedLimitInformation = 9;

        public ServiceJob() : base(true)
        {
            SetHandle(CreateJobObject(IntPtr.Zero, null));
            if (IsInvalid) throw new Win32Exception();

            var limits = new JobLimits();
            limits.Basic.LimitFlags = KillOnJobClose;
            if (!SetInformationJobObject(this, ExtendedLimitInformation, ref limits,
                (uint)Marshal.SizeOf(typeof(JobLimits))))
            {
                var error = new Win32Exception();
                Dispose();
                throw error;
            }
        }

        public void Assign(Process child)
        {
            if (!AssignProcessToJobObject(this, child.Handle))
                throw new Win32Exception();
        }

        protected override bool ReleaseHandle() { return CloseHandle(handle); }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimits
        {
            public long PerProcessUserTime, PerJobUserTime;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperations, WriteOperations, OtherOperations;
            public ulong ReadBytes, WriteBytes, OtherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(ServiceJob job, int infoClass,
            ref JobLimits info, uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(ServiceJob job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
