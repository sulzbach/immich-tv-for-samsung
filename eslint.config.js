import compat from "eslint-plugin-compat";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".buildResult/**",
      ".tizen/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "captures/**",
      ".capture-tools/**",
      "playwright-report/**",
      "test-results/**",
      "scripts/main.js"
    ]
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        KeyboardEvent: "readonly",
        localStorage: "readonly",
        Response: "readonly",
        URL: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-empty-function": "off"
    }
  },
  {
    // The bundled Tizen web service (ADR 0024) runs in the TV's Node runtime
    // as CommonJS, with the TV's `tizen` global, and is shipped as written:
    // plain ES5 that older TVs' Node versions also run, so its `catch`
    // clauses keep a binding they don't always use.
    files: ["service/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        clearInterval: "readonly",
        module: "writable",
        process: "readonly",
        require: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        tizen: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }]
    }
  },
  {
    // Shipped runtime code must run on Tizen 5.0 / Chromium 63 (the
    // package.json browserslist target). esbuild only transpiles syntax, so
    // this rule catches unsupported globals and ES built-ins. DOM members
    // called on element instances are covered by scripts/check-js-compat.mjs.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/test/**"],
    ...compat.configs["flat/recommended"],
    settings: {
      lintAllEsApis: true,
      polyfills: []
    }
  }
);
