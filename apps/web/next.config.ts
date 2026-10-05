import type { NextConfig } from "next";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(self), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // פלט עצמאי לתמונת ה-Docker — server.js מינימלי בלי node_modules מלא
  output: "standalone",
  transpilePackages: ["@metavchim/ui"],
  poweredByHeader: false,
  headers() {
    /*
     * ‎`X-Frame-Options: DENY` על הכול **חוץ מ-`/w/`** — טפסי האתר של
     * המשרד, שנועדו להטמעה (ראו `EMBEDDABLE_PREFIX` ב-middleware, שם
     * גם ה-`frame-ancestors` המקביל). הביטוי שולל את `w/` בתחילת
     * הנתיב בלבד, ולכן `/whatever` נשאר חסום.
     */
    return Promise.resolve([
      { source: "/:path*", headers: baseHeaders },
      { source: "/((?!w/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    ]);
  },
};

export default nextConfig;
