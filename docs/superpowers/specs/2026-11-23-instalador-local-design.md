# Diseño: instalador local de la extensión Colecciones

Fecha: 2026-11-23. Cambio pequeño.

## Intención y motivo

El usuario quiere instalar la extensión en Edge con el mínimo esfuerzo. Edge no
permite instalar extensiones sin empaquetar en silencio en un perfil de
consumidor: siempre hay que activar «Modo desarrollador» y pulsar «Cargar
desempaquetada». El instalador debe dejar todo preparado para que solo queden
esos dos clics, y además debe instalar la extensión en una ruta estable que no
se rompa si se mueve o borra el worktree.

## Objetivos

- Un script `install.ps1` portable y legible.
- Un `.exe` autodescriptivo que lo lance, compilado con `csc.exe` (incluido en
  .NET Framework, sin descargas) e incrustando el ZIP portable como recurso.
- Copiar solo los archivos de ejecución a
  `%LOCALAPPDATA%\Colecciones\Extension`.
- Abrir `edge://extensions` y la carpeta de destino al terminar.

## No objetivos

- Instalar la extensión en silencio ni saltarse los dos clic de Edge.
- Publicar en la tienda ni modificar el perfil del navegador mediante registry.
- Incluir datos personales, fixtures ni archivos de desarrollo.

## Anti-objetivos

- Depender del worktree: la extensión instalada debe vivir en una ruta estable.
- Sobrescribir datos de la extensión guardados por el navegador (están en el
  perfil de Edge, no en la carpeta de archivos; es seguro reemplazar los files).

## Restricciones

- Windows con PowerShell 5.1 y Edge instalado.
- El ZIP de release y los artefactos nuevos deben seguir versionados en git.
- El `.exe` no está firmado: puede aparecer un aviso de SmartScreen al abrirlo.

## Enfoques considerados

| Opción | Trade-off |
| --- | --- |
| Script + EXE con IExpress (elegido) | Un doble clic y todo preparado; coste: aviso de SmartScreen y dos clics manuales en Edge. |
| Solo script | Más transparente, sin EXE; coste: hay que abrir PowerShell y ejecutarlo. |
| Esperar a la tienda | Instalación de un clic y sin avisos; coste: depende de la certificación de Microsoft. |

El usuario eligió **script + EXE**.

## Diseño acordado

- `tools/installer/extension/`: copia de `manifest.json`, `background.js`,
  `sidepanel/`, `content/`, `lib/`, `offscreen/` e `icons/`.
- `tools/installer/install.ps1`: copia `extension\*` a
  `%LOCALAPPDATA%\Colecciones\Extension`, escribe un `LEEME.txt`, abre
  `edge://extensions` y abre la carpeta de destino en Explorer.
- `tools/installer/install.cmd`: envoltorio para el script portable.
- `tools/installer/Installer.cs`: programa C# que incrusta el ZIP, lo extrae,
  copia la extensión a la ruta estable y abre Edge y Explorer.
- `tools/installer/build-installer.ps1`: genera el ZIP y compila el EXE.
- Salidas en `release/`: `instala-colecciones.exe` y
  `instalador-colecciones.zip` (script + carpeta `extension/`).
- Tests: comprueban que ambos artefactos existen y que el ZIP contiene el
  script, el envoltorio y los cuatro iconos.

## Lo que queda al implementador

- Escribir los tests primero y verlos fallar.
- Generar los archivos y compilar el EXE con `csc.exe`.
- Probar el EXE y verificar los archivos instalados.
- Actualizar `.gitignore` y `release/README.txt`, ejecutar la batería y hacer commit.
