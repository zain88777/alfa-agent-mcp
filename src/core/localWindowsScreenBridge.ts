import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ScreenBridge, ScreenObserveResult } from "./screenBridge.js";

const execFileAsync = promisify(execFile);

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Sta", "-Command", script],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  return stdout.trim();
}

async function runPowerShellJson<T>(script: string): Promise<T> {
  const raw = await runPowerShell(script);
  return JSON.parse(raw) as T;
}

function psString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function sendKeysExpression(key: string, modifiers: string[] = []): string {
  const normalized = key.length === 1 ? key : key.toUpperCase();
  const keyMap: Record<string, string> = {
    ENTER: "{ENTER}",
    ESCAPE: "{ESC}",
    ESC: "{ESC}",
    TAB: "{TAB}",
    BACKSPACE: "{BACKSPACE}",
    DELETE: "{DELETE}",
    SPACE: " ",
    ARROWUP: "{UP}",
    ARROWDOWN: "{DOWN}",
    ARROWLEFT: "{LEFT}",
    ARROWRIGHT: "{RIGHT}",
  };
  const body = keyMap[normalized] ?? normalized;
  const prefix = modifiers
    .map((mod) => mod.toLowerCase())
    .map((mod) => (mod === "ctrl" || mod === "control" ? "^" : mod === "alt" ? "%" : mod === "shift" ? "+" : ""))
    .join("");
  return prefix + body;
}

export class LocalWindowsScreenBridge implements ScreenBridge {
  private approved = false;
  private emergencyStopped = false;

  async requestLocalApproval(): Promise<{ approved: boolean; reason?: string }> {
    this.approved = true;
    this.emergencyStopped = false;
    return { approved: true };
  }

  async showControlOverlay(): Promise<void> {}

  async hideControlOverlay(): Promise<void> {
    this.approved = false;
  }

  async getStatus(): Promise<{ approved: boolean; emergencyStopped: boolean }> {
    return { approved: this.approved, emergencyStopped: this.emergencyStopped };
  }

  observe(options: { maxDimension: number; jpegQuality: number }): Promise<ScreenObserveResult> {
    return runPowerShellJson<ScreenObserveResult>(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$targetWidth = $bounds.Width
$targetHeight = $bounds.Height
$maxDimension = ${Math.max(320, Math.min(4096, options.maxDimension))}
$scale = 1.0
if ($targetWidth -gt $maxDimension -or $targetHeight -gt $maxDimension) {
  $scale = [Math]::Min($maxDimension / $targetWidth, $maxDimension / $targetHeight)
  $targetWidth = [Math]::Max(1, [int]($targetWidth * $scale))
  $targetHeight = [Math]::Max(1, [int]($targetHeight * $scale))
}
if ($scale -lt 1.0) {
  $resized = New-Object System.Drawing.Bitmap $targetWidth, $targetHeight
  $rg = [System.Drawing.Graphics]::FromImage($resized)
  $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $rg.DrawImage($bitmap, 0, 0, $targetWidth, $targetHeight)
  $rg.Dispose()
  $bitmap.Dispose()
  $bitmap = $resized
}
$ms = New-Object System.IO.MemoryStream
$quality = [Math]::Max(20, [Math]::Min(95, ${options.jpegQuality}))
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([int64]$quality)
$bitmap.Save($ms, $codec, $encoderParams)
$cursor = [System.Windows.Forms.Cursor]::Position
$result = @{
  imageBase64 = [Convert]::ToBase64String($ms.ToArray())
  width = $targetWidth
  height = $targetHeight
  scaleFactor = $scale
  displayId = 'primary'
  cursor = @{ x = $cursor.X; y = $cursor.Y }
  activeWindowTitle = (Get-Process | Where-Object { $_.MainWindowHandle -eq (Add-Type -PassThru -Name Win32Window -Namespace LocalScreen -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();')::GetForegroundWindow() } | Select-Object -First 1 -ExpandProperty MainWindowTitle)
}
$graphics.Dispose()
$bitmap.Dispose()
$ms.Dispose()
$result | ConvertTo-Json -Compress
`);
  }

  async click(input: { x: number; y: number; button: "left" | "right" | "middle" }): Promise<void> {
    const buttonFlags = {
      left: [0x0002, 0x0004],
      right: [0x0008, 0x0010],
      middle: [0x0020, 0x0040],
    }[input.button];
    await this.move(input);
    await runPowerShell(`
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class MouseApi {
  [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);
}
'@
Start-Sleep -Milliseconds 40
[MouseApi]::mouse_event(${buttonFlags[0]}, 0, 0, 0, 0)
[MouseApi]::mouse_event(${buttonFlags[1]}, 0, 0, 0, 0)
`);
  }

  async move(input: { x: number; y: number }): Promise<void> {
    await runPowerShell(`
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class MouseApi {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
'@
[MouseApi]::SetCursorPos(${Math.round(input.x)}, ${Math.round(input.y)}) | Out-Null
`);
  }

  async doubleClick(input: { x: number; y: number; button: "left" | "right" | "middle" }): Promise<void> {
    await this.click(input);
    await this.click(input);
  }

  async type(input: { text: string }): Promise<void> {
    await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText(${psString(input.text)})
[System.Windows.Forms.SendKeys]::SendWait('^v')
`);
  }

  async key(input: { key: string; modifiers?: string[] }): Promise<void> {
    await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psString(sendKeysExpression(input.key, input.modifiers))})
`);
  }

  async scroll(input: { deltaX?: number; deltaY: number }): Promise<void> {
    await runPowerShell(`
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class WheelApi {
  [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);
}
'@
[WheelApi]::mouse_event(0x0800, 0, 0, ${Math.round(-input.deltaY)}, 0)
`);
  }

  async getActiveWindowTitle(): Promise<string | null> {
    const result = await runPowerShellJson<{ title?: string | null }>(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WindowApi {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
$builder = New-Object System.Text.StringBuilder 512
[WindowApi]::GetWindowText([WindowApi]::GetForegroundWindow(), $builder, $builder.Capacity) | Out-Null
@{ title = $builder.ToString() } | ConvertTo-Json -Compress
`);
    return result.title ?? null;
  }
}
