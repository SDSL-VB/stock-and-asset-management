import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds a self-contained server bundle in .next/standalone, so the Docker
  // image does not need node_modules. See docs/hosting.md.
  //
  // Vercel packages each route itself and warns about this setting, so it is
  // switched off there. VERCEL is set automatically during a Vercel build.
  output: process.env.VERCEL ? undefined : "standalone",

  // The Fulfilment page was split: planning moved to Builds (Plan tab) and site
  // requests to Dispatch. Old bookmarks and links land on the planner, which is
  // what the page was mostly used for. Permanent: false, so it can be changed.
  async redirects() {
    return [{ source: "/fulfilment", destination: "/builds?tab=plan", permanent: false }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // A stock system should never turn up in a search result, hosted or not
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          // Never shown inside another site's frame — otherwise a page could lay
          // itself over "Approve" or "Show password" and trick a click
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          // A file is what it says it is; a mislabelled upload is not run as a page
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Links out do not carry the page address (which holds record ids)
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS only, once a browser has seen the site over HTTPS. Ignored on
          // plain-http localhost, so development is unaffected.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
