import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { NextConfig } from "next";

type WebpackCompiler = {
  hooks: {
    afterEmit: {
      tap: (name: string, callback: () => void) => void;
    };
  };
  options: {
    output: {
      path?: string;
    };
  };
};

const require = createRequire(import.meta.url);
const kaspaWasmPath = require.resolve("kaspa-wasm/kaspa_bg.wasm");

class CopyKaspaWasmPlugin {
  apply(compiler: WebpackCompiler) {
    compiler.hooks.afterEmit.tap("CopyKaspaWasmPlugin", () => {
      const outputPath = compiler.options.output.path;
      if (!outputPath) return;

      for (const targetDir of ["chunks", "vendor-chunks"]) {
        const targetPath = join(outputPath, targetDir, "kaspa_bg.wasm");
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(kaspaWasmPath, targetPath);
      }
    });
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["kaspa-wasm"],
  transpilePackages: [
    "@kaspa-actions/db",
    "@kaspa-actions/kaspa",
    "@kaspa-actions/kaspa-indexer",
    "@kaspa-actions/shared",
  ],
  webpack(config, { isServer }) {
    if (isServer) {
      config.plugins.push(new CopyKaspaWasmPlugin());
    }

    return config;
  },
};

export default nextConfig;
