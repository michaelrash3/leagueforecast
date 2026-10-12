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

      /*
       * An error, not a warning, and `npm run lint` fails on any warning besides.
       *
       * This rule was a warning, so four hand-kept dependency lists sat in App.tsx behind
       * suppressions. Three carried a comment saying the listed values covered the helper they
       * left out, which was true when written. One carried nothing and was wrong: switching a
       * league's postseason format flipped `hasCutLine` without moving anything the list watched,
       * so "Bubble Game" stayed on games that no longer had a cut line to be near. The same shape
       * had already produced a real bug in the command palette, which shared a stale view for a
       * whole season.
       *
       * A warning does not fail CI, so nothing stopped the next one. This does.
       */
      "react-hooks/exhaustive-deps": "error",

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
