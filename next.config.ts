import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds a self-contained server bundle in .next/standalone, so the Docker
  // image does not need node_modules. See docs/hosting.md.
  //
  // Vercel packages each route itself and warns about this setting, so it is
  // switched off there. VERCEL is set automatically during a Vercel build.
  output: process.env.VERCEL ? undefined : "standalone",

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
