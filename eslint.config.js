// ESLint 9 flat config. Replaces .eslintrc.cjs, which ESLint 9 no longer reads: the cascade of
// `extends` strings is gone, and configuration is now an ordered array where later entries
// override earlier ones for the files they match.
//
// The rule set is deliberately identical to what .eslintrc.cjs enforced — this change is about
// leaving an end-of-life major behind, not about tightening lint. Any new finding would be a
// difference in the tooling, not in the code.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "coverage", "**/*.tsbuildinfo", "dev-dist"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // The automatic JSX runtime means React need not be in scope for JSX.
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      "react/prop-types": "off",

      // eslint-plugin-react-hooks 7 folds in the React Compiler's rules. Two of them flag
      // long-standing patterns here — `set-state-in-effect` (10 sites) and `refs` (2) — and both
      // want effects restructured, which is a behaviour change to a working app and has no place
      // inside a dependency upgrade. Off for now, deliberately and visibly, rather than upgraded
      // by way of a blanket downgrade of the whole plugin. Worth revisiting as its own change.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "jsx-a11y/no-autofocus": "off",
    },
  },

  {
    // Workers get their own globals; `self` there is a WorkerGlobalScope, not a Window.
    files: ["src/workers/*.ts"],
    languageOptions: { globals: globals.worker },
  }
);
