// @ts-check
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/", "coverage/", "fabric-network/"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // Formatting is left to Prettier (npm run format).
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Supabase responses are untyped JSON.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
