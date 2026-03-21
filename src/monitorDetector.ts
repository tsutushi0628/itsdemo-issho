import { exec } from "child_process";

interface Resolution {
  width: number;
  height: number;
}

function parseMainDisplayResolution(stdout: string): Resolution | undefined {
  const lines = stdout.split("\n");

  let mainDisplaySectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Main Display: Yes")) {
      mainDisplaySectionStart = i;
      break;
    }
  }

  if (mainDisplaySectionStart >= 0) {
    // Main Displayが見つかった場合、そのセクション内（上方向）のResolutionを探す
    for (let i = mainDisplaySectionStart; i >= 0; i--) {
      const match = lines[i].match(/Resolution:\s+(\d+)\s*x\s*(\d+)/);
      if (match) {
        return {
          width: parseInt(match[1], 10),
          height: parseInt(match[2], 10),
        };
      }
    }
  }

  // シングルモニター環境: Main Display表記がない場合は最初のResolutionを使用
  const firstMatch = stdout.match(/Resolution:\s+(\d+)\s*x\s*(\d+)/);
  if (firstMatch) {
    return {
      width: parseInt(firstMatch[1], 10),
      height: parseInt(firstMatch[2], 10),
    };
  }

  return undefined;
}

export function detectResolution(): Promise<Resolution> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "darwin") {
      reject(new Error("monitorDetector: macOS以外はサポートしていません"));
      return;
    }

    exec(
      "system_profiler SPDisplaysDataType",
      (error, stdout) => {
        if (error) {
          reject(
            new Error(`system_profiler の実行に失敗しました: ${error.message}`)
          );
          return;
        }

        const resolution = parseMainDisplayResolution(stdout);
        if (!resolution) {
          reject(
            new Error(
              "system_profiler の出力からディスプレイ解像度を取得できませんでした"
            )
          );
          return;
        }

        resolve(resolution);
      }
    );
  });
}
