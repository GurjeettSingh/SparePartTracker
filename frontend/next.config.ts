import type { NextConfig } from "next";
import nextPWA from "next-pwa";
import runtimeCaching from "next-pwa/cache";

function getApiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const apiOrigin = getApiOrigin();
const pwaRuntimeCaching = [
  ...(apiOrigin
    ? [
        {
          urlPattern: ({ url }: { url: URL }) => url.origin === apiOrigin,
          handler: "NetworkOnly",
          options: {
            cacheName: "api-network-only",
          },
        },
      ]
    : []),
  ...((runtimeCaching as unknown as unknown[]) || []),
];

const withPWA = nextPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: pwaRuntimeCaching,
  fallbacks: {
    document: "/offline.html",
  },
});

const nextConfig: NextConfig = {};

export default withPWA(nextConfig);
