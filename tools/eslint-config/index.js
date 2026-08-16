import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import securityPlugin from "eslint-plugin-security";
import tsdocPlugin from "eslint-plugin-tsdoc";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/.turbo/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
      security: securityPlugin,
      tsdoc: tsdocPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...importPlugin.flatConfigs.recommended.rules,
      ...securityPlugin.configs.recommended.rules,
      "tsdoc/syntax": "warn",
      "import/no-unresolved": "off",
    },
  },
];
