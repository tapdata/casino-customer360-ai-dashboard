import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the production container small: the runtime image only needs the
  // standalone server and its static assets.
  output: "standalone",
};

export default nextConfig;
