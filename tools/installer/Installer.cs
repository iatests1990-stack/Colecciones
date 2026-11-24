using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

internal static class Installer
{
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

    private static void Main()
    {
        string resourceName = null;
        foreach (string name in Assembly.GetExecutingAssembly().GetManifestResourceNames())
        {
            if (name.EndsWith("payload")) resourceName = name;
        }
        if (resourceName == null)
        {
            MessageBox("No se encontró el paquete de la extensión.");
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
                MessageBox("El paquete de la extensión está incompleto.");
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
                "Pasos para terminar en Microsoft Edge:\r\n" +
                "1. Activa 'Modo desarrollador' en edge://extensions.\r\n" +
                "2. Pulsa 'Cargar desempaquetada' y elige esa carpeta.\r\n\r\n" +
                "Tus colecciones se guardan en el perfil de Edge, no en esta carpeta.\r\n";
            File.WriteAllText(Path.Combine(destination, "LEEME.txt"), readme);

            Process.Start("msedge", "edge://extensions");
            Process.Start("explorer.exe", destination);
            MessageBox("Extensión copiada a:\r\n" + destination +
                "\r\n\r\nActiva el modo desarrollador y carga esa carpeta en Edge.");
        }
        catch (Exception exception)
        {
            MessageBox("No se pudo instalar la extensión:\r\n" + exception.Message);
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
        }
    }

    private static void MessageBox(string message)
    {
        System.Windows.Forms.MessageBox.Show(message, "Colecciones");
    }
}
