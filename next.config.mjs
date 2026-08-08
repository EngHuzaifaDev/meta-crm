/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["metacrm.sarrast.cloud"],
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        process.env.NEXT_PUBLIC_APP_URL,
        "http://localhost:3003",
        "https://metacrm.sarrast.cloud",
      ].filter(Boolean),
    },
  },
};

export default nextConfig;
