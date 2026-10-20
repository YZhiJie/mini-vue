import { defineConfig } from "vitest/config";

// jsdom 环境：watch/patch 相关测试需要操作真实 DOM
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.spec.ts"],
  },
});
