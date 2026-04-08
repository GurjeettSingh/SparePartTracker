import type { NextConfig } from "next";
import nextPWA from "next-pwa";
import runtimeCaching from "next-pwa/cache";

const withPWA = nextPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching,
  fallbacks: {
    document: "/offline.html",
  },
});

const nextConfig: NextConfig = {};

export default withPWA(nextConfig);
