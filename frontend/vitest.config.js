import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/lib/featureLabels.js",
        "src/lib/notifications.js",
        "src/components/ErrorBoundary.jsx",
        "src/components/ProtectedRoute.jsx",
      ],
      exclude: [
        "src/main.jsx",
        "src/**/*.test.{js,jsx}",
        "src/test/**",
      ],
    },
  },
});