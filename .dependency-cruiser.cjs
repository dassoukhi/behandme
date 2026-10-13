/**
 * Dependency rules of the monorepo, checked by `npm run check:deps` (part of `npm run verify`).
 *
 * Inside a service (apps/<name>/src/<module>/...), clean architecture layers point inwards:
 *   domain  <-  application  <-  infrastructure / interface
 * The module file that wires a feature (e.g. users.module.ts) sits outside the layers and may
 * import any of them. Services never import each other: they talk through messages or HTTP.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Import cycles make module initialisation order fragile.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "Every import must resolve (a typo in a path or a missing package).",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-app-to-other-app",
      severity: "error",
      comment:
        "Services are deployed separately: share code through libs/, data through messages.",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-lib-to-app",
      severity: "error",
      comment:
        "Libraries are shared by every service and must not depend on one of them.",
      from: { path: "^libs/" },
      to: { path: "^apps/" },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "Domain code holds the business rules: no framework, no database, no Node API. " +
        "It may only use other domain code and libs/kernel.",
      from: { path: "/domain/" },
      to: { pathNot: ["/domain/", "^libs/kernel/"] },
    },
    {
      name: "application-depends-inwards",
      severity: "error",
      comment:
        "Use cases see the domain, the shared libs and their own ports; adapters are injected. " +
        "@nestjs/common is allowed for @Injectable/@Inject only.",
      from: { path: "/application/" },
      to: {
        pathNot: [
          "/application/",
          "/domain/",
          "^libs/",
          "^node_modules/@nestjs/common/",
        ],
      },
    },
    {
      name: "infrastructure-not-to-interface",
      severity: "error",
      comment:
        "Adapters implement ports; they never call controllers or consumers.",
      from: { path: "/infrastructure/" },
      to: { path: "/interface/" },
    },
    {
      name: "interface-not-to-infrastructure",
      severity: "error",
      comment:
        "Controllers and consumers go through use cases, not straight to adapters.",
      from: { path: "/interface/" },
      to: { path: "/infrastructure/" },
    },
    {
      name: "no-test-code-in-production",
      severity: "error",
      comment: "Specs and test doubles stay out of the deployed code.",
      from: { pathNot: ["\\.spec\\.ts$", "/testing/"] },
      to: {
        path: ["\\.spec\\.ts$", "^libs/testing/", "^apps/[^/]+/src/testing/"],
      },
    },
    {
      name: "no-dev-dependency-in-production",
      severity: "error",
      comment: "A devDependency is not installed in the deployed image.",
      from: { pathNot: ["\\.spec\\.ts$", "/testing/"] },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^dist/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".json"],
    },
  },
};
