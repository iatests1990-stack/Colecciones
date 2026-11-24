using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class Installer
{
    private static readonly string[] ExtensionUrls =
    {
        "edge://extensions", "chrome://extensions", "brave://extensions",
        "vivaldi://extensions", "opera://extensions"
    };

    private sealed class Browser
    {
        public string Name;
        public string Scheme;
        public string Exe;
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        }
        foreach (string directory in Directory.GetDirectories(source))
        {
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
        }
    }

    private static void RunHidden(string file, string arguments)
    {
        ProcessStartInfo start = new ProcessStartInfo(file, arguments);
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        using (Process process = Process.Start(start))
        {
            process.WaitForExit();
        }
    }

    private static List<Browser> DetectBrowsers()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        List<Browser> found = new List<Browser>();

        AddBrowser(found, "Microsoft Edge", "edge",
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(local, @"Microsoft\Edge\Application\msedge.exe"));
        AddBrowser(found, "Google Chrome", "chrome",
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"));
        AddBrowser(found, "Brave", "brave",
            Path.Combine(pf, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
            Path.Combine(local, @"BraveSoftware\Brave-Browser\Application\brave.exe"));
        AddBrowser(found, "Vivaldi", "vivaldi",
            Path.Combine(pf, @"Vivaldi\Application\vivaldi.exe"),
            Path.Combine(local, @"Vivaldi\Application\vivaldi.exe"));
        AddBrowser(found, "Opera", "opera",
            Path.Combine(pf, @"Opera\opera.exe"),
            Path.Combine(pf86, @"Opera\opera.exe"),
            Path.Combine(local, @"Programs\Opera\opera.exe"));
        return found;
    }

    private static void AddBrowser(List<Browser> found, string name, string scheme, params string[] paths)
    {
        foreach (string path in paths)
        {
            if (File.Exists(path))
            {
                found.Add(new Browser { Name = name, Scheme = scheme, Exe = path });
                return;
            }
        }
    }

    private static void Launch(Browser browser, string destination)
    {
        string url = browser.Scheme + "://extensions";
        if (Array.IndexOf(ExtensionUrls, url) < 0)
        {
            throw new InvalidOperationException("Esquema de navegador no soportado: " + url);
        }
        // Chromium ignora las URLs internas por linea de comandos, asi que solo
        // abrimos el navegador y mostramos la URL exacta al usuario.
        Process.Start(browser.Exe);
        Process.Start("explorer.exe", destination);
        MessageBox.Show("Abre esta dirección en " + browser.Name + ":\r\n\r\n" + url +
            "\r\n\r\nDespués activa el modo desarrollador y carga la carpeta:\r\n" +
            destination, "Colecciones");
    }

    private static void ShowChooser(List<Browser> browsers, string destination)
    {
        Form form = new Form();
        form.Text = "Colecciones - elige navegador";
        form.StartPosition = FormStartPosition.CenterScreen;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.ClientSize = new Size(360, 80 + browsers.Count * 42);

        Label label = new Label();
        label.Text = "Elige el navegador donde quieres instalar Colecciones:";
        label.Location = new Point(20, 18);
        label.Size = new Size(320, 24);
        form.Controls.Add(label);

        int top = 52;
        foreach (Browser browser in browsers)
        {
            Button button = new Button();
            button.Text = browser.Name;
            button.Location = new Point(20, top);
            button.Size = new Size(320, 34);
            Browser captured = browser;
            button.Click += delegate { Launch(captured, destination); form.Close(); };
            form.Controls.Add(button);
            top += 42;
        }
        form.ShowDialog();
    }

    private static void Main()
    {
        string resourceName = null;
        foreach (string name in Assembly.GetExecutingAssembly().GetManifestResourceNames())
        {
            if (name.EndsWith("payload")) resourceName = name;
        }
        if (resourceName == null)
        {
            MessageBox.Show("No se encontró el paquete de la extensión.", "Colecciones");
            return;
        }

        string temp = Path.Combine(Path.GetTempPath(), "colecciones-instalar-" + Guid.NewGuid().ToString("N"));
        string zip = Path.Combine(temp, "payload.zip");
        Directory.CreateDirectory(temp);
        try
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            using (FileStream output = File.Create(zip))
            {
                stream.CopyTo(output);
            }

            RunHidden("powershell.exe",
                "-NoProfile -Command \"Expand-Archive -LiteralPath '" + zip +
                "' -DestinationPath '" + temp + "' -Force\"");

            string source = Path.Combine(temp, "extension");
            if (!Directory.Exists(source))
            {
                MessageBox.Show("El paquete de la extensión está incompleto.", "Colecciones");
                return;
            }

            string destination = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Colecciones", "Extension");
            Directory.CreateDirectory(destination);
            foreach (string file in Directory.GetFiles(destination, "*", SearchOption.AllDirectories))
            {
                File.Delete(file);
            }
            CopyDirectory(source, destination);

            string readme =
                "Colecciones - extension instalada en:\r\n" + destination + "\r\n\r\n" +
                "Pasos para terminar:\r\n" +
                "1. Abre la pagina de extensiones de tu navegador Chromium.\r\n" +
                "2. Activa 'Modo desarrollador'.\r\n" +
                "3. Pulsa 'Cargar desempaquetada' y elige esa carpeta.\r\n\r\n" +
                "Tus colecciones se guardan en el perfil del navegador.\r\n";
            File.WriteAllText(Path.Combine(destination, "LEEME.txt"), readme);

            List<Browser> browsers = DetectBrowsers();
            if (browsers.Count == 0)
            {
                MessageBox.Show("No se detectó ningún navegador Chromium compatible.\r\n" +
                    "Abre manualmente la página de extensiones de tu navegador y carga:\r\n" +
                    destination, "Colecciones");
                Process.Start("explorer.exe", destination);
            }
            else if (browsers.Count == 1)
            {
                Launch(browsers[0], destination);
            }
            else
            {
                ShowChooser(browsers, destination);
            }
        }
        catch (Exception exception)
        {
            MessageBox.Show("No se pudo instalar la extensión:\r\n" + exception.Message, "Colecciones");
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
        }
    }
}
