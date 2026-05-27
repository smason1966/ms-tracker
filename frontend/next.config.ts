import type { NextConfig } from "next";

const allowedDevOrigins = process.env.LOCAL_APP_HOST
  ? [process.env.LOCAL_APP_HOST]
  : undefined;

const nextConfig: NextConfig = {
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
