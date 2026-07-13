import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: path.resolve(__dirname),
  allowedDevOrigins: ["192.168.11.114", "*.192.168.11.114"]
};

export default nextConfig;
