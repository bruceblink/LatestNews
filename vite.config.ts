import dotenv from "dotenv";
import { join } from "node:path";
import unocss from "unocss/vite";
import { defineConfig } from "vite";
import unimport from "unimport/unplugin";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

import pwa from "./pwa.config";
import { projectDir } from "./shared/dir";
import initVoteNitro from "./nitro.config";

dotenv.config({
  path: join(projectDir, ".env.server"),
});

export default defineConfig({
  resolve: {
    alias: {
      "~": join(projectDir, "src"),
      "@shared": join(projectDir, "shared"),
    },
  },
  plugins: [
    TanStackRouterVite({
      // error with auto import and vite-plugin-pwa
      // autoCodeSplitting: true,
    }),
    unimport.vite({
      dirs: ["src/hooks", "shared", "src/utils", "src/atoms"],
      presets: [
        "react",
        {
          from: "jotai",
          imports: ["atom", "useAtom", "useAtomValue", "useSetAtom"],
        },
      ],
      imports: [
        { from: "clsx", name: "clsx", as: "$" },
        { from: "jotai/utils", name: "atomWithStorage" },
      ],
      dts: "imports.app.d.ts",
    }),
    unocss(),
    react(),
    pwa(),
    initVoteNitro(),
  ],
});
