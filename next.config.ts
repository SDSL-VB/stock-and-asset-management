import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds a self-contained server bundle in .next/standalone, so the Docker
  // image does not need node_modules. See docs/hosting.md.
  output: "standalone",

  async headers() {
    return [
      {
        // A stock system should never turn up in a search result, hosted or not.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
