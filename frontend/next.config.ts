import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // Proxy requests to the Flask API URL on the server-side, bypassing CORS/Mixed Content.
        destination: `${process.env.FLASK_API_URL || "http://localhost:5000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
