declare module "next-pwa" {
  import type { NextConfig } from "next";

  export type NextPwaPluginOptions = {
    dest?: string;
    register?: boolean;
    skipWaiting?: boolean;
    disable?: boolean;
    runtimeCaching?: unknown;
    fallbacks?: {
      document?: string;
      image?: string;
      font?: string;
      audio?: string;
      video?: string;
    };
    [key: string]: unknown;
  };

  export default function nextPWA(
    options: NextPwaPluginOptions
  ): (nextConfig: NextConfig) => NextConfig;
}

declare module "next-pwa/cache" {
  const runtimeCaching: unknown;
  export default runtimeCaching;
}
