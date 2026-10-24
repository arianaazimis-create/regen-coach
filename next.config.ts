import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The API routes read the cached JSON in data/ at request time; make sure it ships with the deploy.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/trips/**/*", "./data/routes/**/*"],
  },
};

export default nextConfig;
