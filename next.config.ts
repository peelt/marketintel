import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Per ym2 lesson: never silently ignore build errors
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Allow longer server actions for agent runs
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
