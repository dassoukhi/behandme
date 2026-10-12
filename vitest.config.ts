import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same scope as the former Jest config: the chaincode and the downloaded
    // fabric-samples have their own test setups.
    include: ["src/**/*.spec.ts"],
  },
});
