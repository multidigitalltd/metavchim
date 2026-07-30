import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(self), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // פלט עצמאי לתמונת ה-Docker — server.js מינימלי בלי node_modules מלא
  output: "standalone",
  transpilePackages: ["@metavchim/ui"],
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default nextConfig;
