import * as esbuild from "esbuild";
import { cpSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const isWatch = process.argv.includes("--watch");

/** ビルド後に VSCode 拡張フォルダへ自動コピー */
function deployToExtensions() {
  const extDir = join(homedir(), ".vscode", "extensions", "tsukamoto.editor-spotlighter-0.0.1");
  try {
    cpSync("dist/extension.js", join(extDir, "dist", "extension.js"));
    cpSync("dist/extension.js.map", join(extDir, "dist", "extension.js.map"));
    cpSync("package.json", join(extDir, "package.json"));
    console.log("Deployed to VSCode extensions folder.");
  } catch (e) {
    console.log("Note: Could not deploy to extensions folder:", e.message);
  }
}

/** esbuild プラグイン: ビルド完了時にデプロイ */
const deployPlugin = {
  name: "deploy-to-extensions",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        deployToExtensions();
      }
    });
  },
};

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  platform: "node",
  outdir: "dist",
  format: "cjs",
  sourcemap: true,
  plugins: [deployPlugin],
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete.");
}
