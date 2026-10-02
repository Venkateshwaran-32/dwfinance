import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 blocks /_next/* dev resources from non-localhost origins by default,
  // which silently breaks client hydration when the app is opened via 127.0.0.1.
  // Allow both so interactivity works regardless of how the URL is typed.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
