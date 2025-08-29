// .github/scripts/build-dep-graph.cjs
const { cruise } = require("dependency-cruiser");
const fs = require("fs");
const path = require("path");

const ROOTS = ["src", "app", "server"].filter((p) => fs.existsSync(p));

(async () => {
  try {
    if (ROOTS.length === 0) {
      console.log("No src/app/server folder found; scanning repo root.");
      ROOTS.push(".");
    }
    const result = cruise(ROOTS, {
      ruleSet: require(path.resolve(".dependency-cruiser.cjs")),
      outputType: "json"
    });

    const out = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
    const outFile = ".github/ai/dep-graph.json";
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, out, "utf8");
    console.log(`Dependency graph written to ${outFile}`);
  } catch (e) {
    console.error("Failed to build dependency graph (continuing):", e);
    process.exit(0); // do not fail the workflow — Phase1 should still run
  }
})();
