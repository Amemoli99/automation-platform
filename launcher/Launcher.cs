// Launcher di Nexsoft Automation Cockpit. Build: ui\build-exe.ps1
// Avvia il server con `node` (ui\server.js nel pacchetto, src\server\main.js nel repository), se la porta non è già in ascolto, e apre il browser.
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Windows.Forms;

static class Launcher
{
    const string Host = "127.0.0.1";

    static bool PortOpen(int port)
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect(Host, port, null, null);
                return ar.AsyncWaitHandle.WaitOne(300) && c.Connected;
            }
        }
        catch { return false; }
    }

    static string DataDir()
    {
        var dir = Environment.GetEnvironmentVariable("UI_DATA_DIR");
        if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Environment.GetEnvironmentVariable("APPDATA") ?? "", "developerTest-UI");
        return dir;
    }

    // Il server scrive la chiave di accesso di questa sessione in %APPDATA%\developerTest-UI\session-<porta>.json.
    static string SessionFile(int port)
    {
        return Path.Combine(DataDir(), "session-" + port + ".json");
    }

    // Senza finestra console l'output del server va qui (riscritto a ogni avvio).
    static string LogFile()
    {
        return Path.Combine(DataDir(), "server.log");
    }

    static string SessionToken(int port)
    {
        try
        {
            var f = SessionFile(port);
            if (!File.Exists(f)) return null;
            var m = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(f), "\"token\"\\s*:\\s*\"([A-Za-z0-9_-]+)\"");
            return m.Success ? m.Groups[1].Value : null;
        }
        catch { return null; }
    }

    [STAThread]
    static int Main()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        // Pacchetto distribuito: ui\server.js (unito e offuscato). Repository: src\server\main.js (sorgenti).
        var server = Path.Combine(root, "ui", "server.js");
        if (!File.Exists(server)) server = Path.Combine(root, "src", "server", "main.js");
        int port;
        if (!int.TryParse(Environment.GetEnvironmentVariable("UI_PORT"), out port)) port = 4173;
        var url = "http://" + Host + ":" + port + "/";

        if (!File.Exists(server))
        {
            MessageBox.Show("Non trovo il server accanto all'eseguibile (cercato ui\\server.js e src\\server\\main.js):\n" + root, "Nexsoft Automation Cockpit", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        if (!PortOpen(port))
        {
            // un file di sessione rimasto da un'esecuzione interrotta conterrebbe una chiave non più valida
            try { File.Delete(SessionFile(port)); } catch { /* il server lo riscrive comunque */ }
            try
            {
                // Nessuna finestra console: il server si ferma dal pulsante Chiudi dell'app.
                // L'output passa da cmd (non da un pipe del launcher, che esce subito) e finisce in server.log.
                Directory.CreateDirectory(DataDir());
                Process.Start(new ProcessStartInfo("cmd.exe", "/c \"node \"" + server + "\" > \"" + LogFile() + "\" 2>&1\"")
                {
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
            }
            catch (Exception e)
            {
                MessageBox.Show("Impossibile avviare Node.js (è installato e nel PATH?)\n\n" + e.Message, "Nexsoft Automation Cockpit", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            var t0 = DateTime.UtcNow;
            while (!PortOpen(port))
            {
                if ((DateTime.UtcNow - t0).TotalSeconds > 15)
                {
                    MessageBox.Show("Il server non risponde su " + url + " dopo 15 s.\nControlla l'errore in " + LogFile() + " (Node non nel PATH? porta occupata?).", "Nexsoft Automation Cockpit", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                System.Threading.Thread.Sleep(250);
            }
        }

        // chiave di accesso: il server la scrive subito dopo l'avvio
        string token = null;
        for (int i = 0; i < 40 && token == null; i++)
        {
            token = SessionToken(port);
            if (token == null) System.Threading.Thread.Sleep(150);
        }
        if (token == null)
        {
            MessageBox.Show("Il server è in esecuzione ma non ha pubblicato la chiave di accesso.\n\nÈ probabile che sia una versione precedente: chiudilo (pulsante Chiudi nell'app, o termina il processo node da Gestione attività) e riavvia questo programma.", "Nexsoft Automation Cockpit", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        // UI_LAUNCH_URL_FILE: solo per i test automatici (scrive l'indirizzo invece di aprire il browser)
        var urlFile = Environment.GetEnvironmentVariable("UI_LAUNCH_URL_FILE");
        if (!string.IsNullOrEmpty(urlFile)) { File.WriteAllText(urlFile, url + "?t=" + token); return 0; }
        OpenUi(url + "?t=" + token);
        return 0;
    }

    // Edge o Chrome in modalità app (finestra senza barra degli indirizzi): lì il pulsante Chiudi della UI può chiudere la finestra
    // (window.close() in una scheda normale è bloccato dal browser). Senza Edge/Chrome si apre il browser predefinito.
    static string AppBrowser()
    {
        string pf = Environment.GetEnvironmentVariable("ProgramFiles"), pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)"), local = Environment.GetEnvironmentVariable("LocalAppData");
        var candidates = new[] {
            Path.Combine(pf86 ?? "", @"Microsoft\Edge\Application\msedge.exe"), Path.Combine(pf ?? "", @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf ?? "", @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86 ?? "", @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local ?? "", @"Google\Chrome\Application\chrome.exe"),
        };
        foreach (var c in candidates) if (File.Exists(c)) return c;
        return null;
    }

    // Il browser ricorda la dimensione dell'ultima finestra app e --start-maximized non basta: si passano le misure e, se serve, si massimizza da qui.
    // Finestre della UI = finestre Chrome/Edge con il titolo della pagina; si prende quella comparsa dopo l'avvio.
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    delegate bool EnumProc(IntPtr h, IntPtr p);

    static System.Collections.Generic.List<IntPtr> UiWindows()
    {
        var list = new System.Collections.Generic.List<IntPtr>();
        EnumWindows((h, p) =>
        {
            if (!IsWindowVisible(h)) return true;
            var cls = new System.Text.StringBuilder(64); GetClassName(h, cls, 64);
            if (cls.ToString() != "Chrome_WidgetWin_1") return true;
            var title = new System.Text.StringBuilder(256); GetWindowText(h, title, 256);
            if (title.ToString().Contains("Nexsoft Automation Cockpit Platform")) list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    static void MaximizeNewWindow(System.Collections.Generic.List<IntPtr> before)
    {
        for (int i = 0; i < 60; i++) // fino a ~15 s
        {
            foreach (var h in UiWindows())
                if (!before.Contains(h)) { ShowWindow(h, 3 /* SW_MAXIMIZE */); SetForegroundWindow(h); return; }
            System.Threading.Thread.Sleep(250);
        }
    }

    static void OpenUi(string address)
    {
        var browser = AppBrowser();
        if (browser != null)
        {
            try
            {
                var before = UiWindows();
                // Posizione e dimensione esplicite (area di lavoro dello schermo principale): la finestra nasce già grande invece di
                // usare l'ultima dimensione ricordata dal browser. Valori in pixel logici, come li vuole il browser.
                var wa = Screen.PrimaryScreen.WorkingArea;
                // Profilo dedicato all'app: con un browser già aperto l'avvio passerebbe all'istanza esistente, che ignora posizione e misure.
                var data = Environment.GetEnvironmentVariable("UI_DATA_DIR");
                if (string.IsNullOrEmpty(data)) data = Path.Combine(Environment.GetEnvironmentVariable("APPDATA") ?? Path.GetTempPath(), "developerTest-UI");
                var profile = Path.Combine(data, "browser");
                var args = "--user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-sync --disable-features=msImplicitSignin,msEdgeImplicitSignin,msEdgeSyncConsent --window-position=" + wa.X + "," + wa.Y + " --window-size=" + wa.Width + "," + wa.Height + " --app=\"" + address + "\"";
                Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false });
                MaximizeNewWindow(before); // rete di sicurezza: se il browser ignora le misure, la finestra si massimizza comunque
                return;
            }
            catch { /* ripiego sul browser predefinito */ }
        }
        Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
    }
}
