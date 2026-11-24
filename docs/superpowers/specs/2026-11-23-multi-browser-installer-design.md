# Diseño: instalador multi-navegador Chromium

Fecha: 2026-11-23. Cambio pequeño sobre el instalador local.

## Intención y motivo

El usuario quiere instalar la extensión también en otros navegadores Chromium.
La extensión ya es portable (Chromium ≥ 114), pero el instalador actual abre
siempre Edge. Debe detectar los navegadores disponibles y dejar elegir cuál
abrir.

## Objetivos

- Detectar Edge, Chrome, Brave, Vivaldi y Opera por rutas conocidas de Windows.
- Copiar la extensión a la misma ruta estable de siempre.
- Abrir la página de extensiones del navegador elegido y el Explorador.
- Mantener el EXE y el script portable funcionando.

## No objetivos

- Instalar la extensión en silencio (Edge y Chromium siguen exigiendo clics).
- Soportar navegadores no Chromium (Firefox, Safari).
- Añadir dependencias externas.

## Anti-objetivos

- Asumir que Edge está instalado.
- Abrir una página de extensiones equivocada para el navegador elegido.

## Restricciones

- Windows, PowerShell 5.1, .NET Framework para el EXE.
- Esquemas: `edge://extensions`, `chrome://extensions`, `brave://extensions`,
  `vivaldi://extensions`, `opera://extensions`.
- Si no se detecta ninguno, el instalador debe copiar los archivos y avisar.

## Enfoques

| Opción | Trade-off |
| --- | --- |
| Menú en consola (script) + botones WinForms (EXE) | Simple y transparente; el script requiere ejecutarse desde PowerShell. Elegido. |
| Un único diálogo WinForms compartido | Más consistente, pero más código en el script. |
| Detectar solo el primer navegador | Menos código, pero no sirve si el usuario tiene varios. |

El usuario eligió detectar navegadores.

## Diseño acordado

- `install.ps1`: comprueba las rutas de los cinco navegadores, muestra un menú
  numerado con `Read-Host`, y lanza `<exe> <esquema>://extensions` más el
  Explorador. Si solo hay uno, lo selecciona automáticamente.
- `Installer.cs`: comprueba las mismas rutas y muestra un pequeño formulario
  WinForms con un botón por navegador detectado.
- `LEEME.txt` y `release/README.txt`: indican que sirve para cualquier
  navegador Chromium ≥ 114 y que el panel lateral puede variar fuera de
  Edge/Chrome.

## Lo que queda al implementador

- Tests RED que exijan los cinco navegadores y esquemas en ambos archivos.
- Actualizar script, C#, textos, regenerar ZIP y EXE, probar el EXE.
- Ejecutar la batería, actualizar docs y hacer commit.
