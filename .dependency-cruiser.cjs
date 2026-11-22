/** Backend のレイヤー境界: api → service → line → storage。テストは対象外。 */
const backend = "^Vyline/backend/src/";
const notTest = "\\.test\\.ts$";

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: { pathNot: notTest },
      to: { circular: true },
    },
    {
      name: "storage-no-upper-layer",
      severity: "error",
      from: { path: `${backend}storage/`, pathNot: notTest },
      to: { path: `${backend}(api|service|line)/` },
    },
    {
      name: "service-no-api",
      severity: "error",
      from: { path: `${backend}service/`, pathNot: notTest },
      to: { path: `${backend}api/` },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "Vyline/backend/tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
