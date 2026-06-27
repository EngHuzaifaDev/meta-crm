/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",                 // 👈 required for production Docker
  reactCompiler: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/crm",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;