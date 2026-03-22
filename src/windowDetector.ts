import { exec } from "child_process";

export function detectWindowWidth(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (process.platform === "darwin") {
      exec(
        `osascript -e 'tell application "Visual Studio Code" to get bounds of window 1'`,
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                `osascript の実行に失敗しました: ${error.message}`
              )
            );
            return;
          }

          const width = parseMacOSBounds(stdout);
          resolve(width);
        }
      );
    } else if (process.platform === "win32") {
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [StructLayout(LayoutKind.Sequential)]
            public struct RECT { public int Left, Top, Right, Bottom; }
            [DllImport("user32.dll")]
            public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
          }
"@
        $hwnd = [Win32]::GetForegroundWindow()
        $rect = New-Object Win32+RECT
        [Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
        Write-Output ($rect.Right - $rect.Left)
      `.trim();

      exec(
        `powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`,
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                `PowerShell の実行に失敗しました: ${error.message}`
              )
            );
            return;
          }

          const width = parseWindowsOutput(stdout);
          resolve(width);
        }
      );
    } else if (process.platform === "linux") {
      exec(
        "xdotool getactivewindow getwindowgeometry",
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                `xdotool の実行に失敗しました: ${error.message}`
              )
            );
            return;
          }

          const width = parseLinuxGeometry(stdout);
          resolve(width);
        }
      );
    } else {
      reject(
        new Error(
          `windowDetector: サポートされていないプラットフォームです: ${process.platform}`
        )
      );
    }
  });
}

export function parseMacOSBounds(stdout: string): number {
  // osascript output format: "x1, y1, x2, y2\n"
  const parts = stdout.trim().split(",");
  if (parts.length < 4) {
    throw new Error(
      `osascript の出力をパースできませんでした: "${stdout.trim()}"`
    );
  }

  const x1 = parseInt(parts[0].trim(), 10);
  const x2 = parseInt(parts[2].trim(), 10);

  if (isNaN(x1) || isNaN(x2)) {
    throw new Error(
      `osascript の出力から座標を取得できませんでした: "${stdout.trim()}"`
    );
  }

  return x2 - x1;
}

export function parseWindowsOutput(stdout: string): number {
  const width = parseInt(stdout.trim(), 10);

  if (isNaN(width)) {
    throw new Error(
      `PowerShell の出力からウィンドウ幅を取得できませんでした: "${stdout.trim()}"`
    );
  }

  return width;
}

export function parseLinuxGeometry(stdout: string): number {
  // xdotool output format:
  // Window 12345678
  //   Position: 100,200 (screen: 0)
  //   Geometry: 1920x1080
  const match = stdout.match(/Geometry:\s+(\d+)x(\d+)/);
  if (!match) {
    throw new Error(
      `xdotool の出力からウィンドウサイズを取得できませんでした: "${stdout.trim()}"`
    );
  }

  return parseInt(match[1], 10);
}
