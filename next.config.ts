import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // transformers.js (local precedent embeddings) pulls in onnxruntime-node, which
  // has native binaries that must not be bundled by webpack/turbopack — keep it
  // external so it's required from node_modules at runtime.
  serverExternalPackages: ["@xenova/transformers"],
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  disableLogger: true,
  tunnelRoute: "/monitoring",
});
