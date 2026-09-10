import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local-dev embedded Postgres) ships wasm assets that must load from node_modules, not a bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
