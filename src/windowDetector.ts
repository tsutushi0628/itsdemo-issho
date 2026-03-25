import { exec } from "child_process";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getWindowBounds(): Promise<WindowBounds> {
  return new Promise((resolve, reject) => {
    const swiftScript = `
import CoreGraphics
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String, owner == "Code",
       let bounds = w["kCGWindowBounds"] as? [String: Any],
       let width = bounds["Width"] as? Double,
       width >= 500,
       let x = bounds["X"] as? Double,
       let y = bounds["Y"] as? Double,
       let height = bounds["Height"] as? Double {
        print("\\(x),\\(y),\\(width),\\(height)")
        break
    }
}
`;

    exec(`swift -e '${swiftScript}'`, (error, stdout) => {
      if (error) {
        reject(new Error(`swift の実行に失敗しました: ${error.message}`));
        return;
      }

      const parts = stdout.trim().split(",");
      if (parts.length < 4) {
        reject(new Error(`ウィンドウ情報を取得できませんでした: "${stdout.trim()}"`));
        return;
      }

      resolve({
        x: parseFloat(parts[0]),
        y: parseFloat(parts[1]),
        width: parseFloat(parts[2]),
        height: parseFloat(parts[3]),
      });
    });
  });
}

export function detectWindowWidth(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (process.platform === "darwin") {
      // macOS: Swift CGWindowList API（アクセシビリティ権限不要）
      const swiftScript = `
import CoreGraphics
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String, owner == "Code",
       let bounds = w["kCGWindowBounds"] as? [String: Any],
       let width = bounds["Width"] as? Double,
       width >= 500 {
        print(Int(width))
        break
    }
}
`;

      exec(`swift -e '${swiftScript}'`, (error, stdout) => {
        if (error) {
          reject(
            new Error(
              `swift の実行に失敗しました: ${error.message}`
            )
          );
          return;
        }

        const width = parseInt(stdout.trim(), 10);
        if (isNaN(width) || width <= 0) {
          reject(
            new Error(
              `ウィンドウ幅を取得できませんでした: "${stdout.trim()}"`
            )
          );
          return;
        }

        resolve(width);
      });
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
