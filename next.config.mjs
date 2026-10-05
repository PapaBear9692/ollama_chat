const nextConfig = {
  // allow the dev server to serve chunks/HMR when the site is opened from the
  // LAN IP (phone testing on http://172.17.15.141:3100). Next 16 blocks
  // cross-origin dev assets by default; entries must be bare hostnames.
  allowedDevOrigins: ["172.17.15.141"],

  // native/cjs modules that must not be bundled into server routes
  serverExternalPackages: ["@lancedb/lancedb", "pdf-parse"],
};

export default nextConfig;
