import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      /**
       * A capped baseline, not an endorsement.
       *
       * These two rules have a large number of pre-existing violations. Blocking
       * CI on them today would mean choosing between having no CI at all and
       * landing a sweeping typing change with no test coverage to catch a
       * mistake — both worse than the debt itself.
       *
       * So they are warnings, and `npm run lint:ci` caps the total warning count.
       * A new violation pushes the count over the cap and fails the build, so the
       * debt can shrink but never grow. When you fix some, lower the cap in
       * package.json. Never raise it.
       */
      "@typescript-eslint/no-explicit-any": "warn",
      /**
       * Real smells, not style — cascading renders and derive-during-render
       * violations, all in `app/admin/*`. Kept visible under the same cap rather
       * than fixed blind: the admin UI has no test coverage, and each one needs
       * a genuine restructure (deriving state during render, or moving a fetch
       * out of an effect) that is not safe to do as part of setting up CI.
       */
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          // `_`-prefixed names are deliberately unused.
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // `catch (e)` where the error is intentionally swallowed.
          caughtErrors: "none",
        },
      ],
    },
  },
]);

export default eslintConfig;
