/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  experimental: {
    serverActions: {
      allowedOrigins: [process.env.NEXT_PUBLIC_APP_URL].filter(Boolean),
    },
  },
};

export default nextConfig;
