/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname, // treat this folder (frontend/) as the workspace root
  },
};

module.exports = nextConfig;