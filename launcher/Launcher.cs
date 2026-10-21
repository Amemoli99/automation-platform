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

    // Il server scrive la chiave di accesso di questa sessione in %APPDATA%\developerTest-UI\session-<porta>.json.
    static string SessionFile(int port)
    {
        var dir = Environment.GetEnvironmentVariable("UI_DATA_DIR");
        if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Environment.GetEnvironmentVariable("APPDATA") ?? "", "developerTest-UI");
        return Path.Combine(dir, "session-" + port + ".json");
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
                // Finestra console visibile: chiuderla (o Ctrl+C) ferma il server.
                Process.Start(new ProcessStartInfo("node", "\"" + server + "\"")
                {
                    WorkingDirectory = root,
                    UseShellExecute = true,
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
                    MessageBox.Show("Il server non risponde su " + url + " dopo 15 s.\nControlla la finestra di Node per l'errore (porta occupata?).", "Nexsoft Automation Cockpit", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            MessageBox.Show("Il server è in esecuzione ma non ha pubblicato la chiave di accesso.\n\nÈ probabile che sia una versione precedente: chiudilo (finestra di Node) e riavvia questo programma.", "Nexsoft Automation Cockpit", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        // UI_LAUNCH_URL_FILE: solo per i test automatici (scrive l'indirizzo invece di aprire il browser)
        var urlFile = Environment.GetEnvironmentVariable("UI_LAUNCH_URL_FILE");
        if (!string.IsNullOrEmpty(urlFile)) { File.WriteAllText(urlFile, url + "?t=" + token); return 0; }
        Process.Start(new ProcessStartInfo(url + "?t=" + token) { UseShellExecute = true });
        return 0;
    }
}
