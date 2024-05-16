// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

const eslintPluginPreferLetPlugin = {
  rules: {
    "prefer-let": {
      meta: {
        docs: {
          description: "Use `let` declarations to bind names to values",
          category: "Stylistic Issues",
          recommended: false,
        },
        fixable: "code", // or "code" or "whitespace"
        schema: [
          // fill in your schema
        ],
      },

      create: function (context) {
        let sourceCode = context.sourceCode ?? context.getSourceCode();

        //----------------------------------------------------------------------
        // Helpers
        //----------------------------------------------------------------------

        function getScope(node) {
          return sourceCode.getScope
            ? sourceCode.getScope(node)
            : context.getScope();
        }

        function isGlobalScope(node) {
          let scope = getScope(node);
          return scope.type === "global";
        }

        function isModuleScope(node) {
          let scope = getScope(node);
          return scope.type === "module";
        }

        function isProgramScope(node) {
          let scope = getScope(node);
          return scope.block.type === "Program";
        }

        function isTopLevelScope(node) {
          return (
            isGlobalScope(node) || isModuleScope(node) || isProgramScope(node)
          );
        }

        //----------------------------------------------------------------------
        // Public
        //----------------------------------------------------------------------

        return {
          VariableDeclaration(node) {
            if (node.kind === "var") {
              context.report({
                message: "prefer `let` over `var` to declare value bindings",
                node,
              });
            } else if (node.kind !== "let" && !isTopLevelScope(node)) {
              let constToken = sourceCode.getFirstToken(node);

              context.report({
                message: "`const` declaration outside top-level scope",
                node,
                fix: function (fixer) {
                  return fixer.replaceText(constToken, "let");
                },
              });
            }
          },
        };
      },
    },
  },
  meta: {},
  configs: {},
  processors: {},
};

let eslintPluginPreferLet = {
  plugins: {
    "prefer-let": eslintPluginPreferLetPlugin,
  },
  rules: {
    "prefer-let/prefer-let": "error",
    "prefer-const": "off",
  },
};

export default tseslint.config({
  extends: [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    eslintPluginPreferLet,
  ],
  ignores: ["node_modules/", "dist/"],
  rules: {
    "prefer-const": "off",
  },
});
