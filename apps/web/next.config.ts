import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isUserOrOrganizationPage = repositoryName?.endsWith(".github.io") ?? false;

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : "standalone",
  basePath: isGitHubPages && repositoryName && !isUserOrOrganizationPage ? `/${repositoryName}` : undefined,
  trailingSlash: isGitHubPages,
  images: isGitHubPages ? { unoptimized: true } : undefined,
  cacheComponents: !isGitHubPages,
  partialPrefetching: !isGitHubPages,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
