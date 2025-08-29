// .github/scripts/impact-analysis.cjs
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Project } = require("ts-morph");

function getChangedFiles(base, head) {
  const out = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
  return out.split("\n").map(s => s.trim()).filter(Boolean)
    .filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
}

function loadDepGraph() {
  const p = ".github/ai/dep-graph.json";
  if (!fs.existsSync(p)) return null;
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  return json;
}

function buildReverseGraph(modules) {
  const reverse = new Map();
  const norm = (f) => f.replace(/\\/g, "/");
  for (const m of modules) {
    const from = norm(m.source);
    for (const d of (m.dependencies || [])) {
      if (!d.resolved) continue;
      const to = norm(d.resolved);
      if (!reverse.has(to)) reverse.set(to, new Set());
      reverse.get(to).add(from);
    }
  }
  return reverse;
}

function resolveToModulePath(file, modules) {
  const normFile = file.replace(/\\/g, "/");
  const candidates = [
    normFile,
    normFile.replace(/\.(tsx|ts|jsx|js)$/, ""),
  ];
  for (const m of modules) {
    const src = m.source.replace(/\\/g, "/");
    if (candidates.some(c => src.endsWith(c))) {
      return src;
    }
  }
  return null;
}

function bfsImpacted(startFiles, reverse, modules, maxDepth = 6) {
  const impacted = new Map();
  const queue = [];

  for (const f of startFiles) {
    const node = resolveToModulePath(f, modules) || f;
    impacted.set(node, 0);
    queue.push([node, 0]);
  }

  while (queue.length) {
    const [node, depth] = queue.shift();
    if (depth >= maxDepth) continue;
    const nexts = reverse.get(node) || new Set();
    for (const dep of nexts) {
      const cur = impacted.get(dep);
      if (cur === undefined || depth + 1 < cur) {
        impacted.set(dep, depth + 1);
        queue.push([dep, depth + 1]);
      }
    }
  }

  return [...impacted.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([file, depth]) => ({ file, depth }));
}

function collectExports(files) {
  const project = new Project({
    tsConfigFilePath: fs.existsSync("tsconfig.json") ? "tsconfig.json" : undefined,
    skipAddingFilesFromTsConfig: true
  });
  files.forEach(f => { if (fs.existsSync(f)) project.addSourceFileAtPath(f); });
  const map = {};
  for (const sf of project.getSourceFiles()) {
    const key = sf.getFilePath().replace(/\\/g, "/");
    map[key] = [];
    sf.getFunctions().forEach(fn => {
      if (fn.isExported()) map[key].push(fn.getName() || "default(function)");
    });
    sf.getClasses().forEach(cls => {
      if (cls.isExported()) map[key].push(cls.getName() || "default(class)");
    });
    sf.getExportSymbols().forEach(sym => {
      const n = sym.getName();
      if (n && !map[key].includes(n)) map[key].push(n);
    });
  }
  return map;
}

(function main() {
  try {
    const base = process.env.BASE_SHA;
    const head = process.env.HEAD_SHA;
    const changed = getChangedFiles(base, head);

    const graph = loadDepGraph();
    if (!graph || !graph.modules) {
      const payload = { changed, impacted: [], exports: {} };
      fs.mkdirSync(".github/ai", { recursive: true });
      fs.writeFileSync(".github/ai/impact.json", JSON.stringify(payload, null, 2));
      console.log("No dep-graph; wrote empty impact.json");
      return;
    }

    const reverse = buildReverseGraph(graph.modules);
    const impacted = bfsImpacted(changed, reverse, graph.modules, 6);

    const top = impacted.slice(0, 50).map(i => i.file);
    const exportMap = collectExports([...new Set([...changed, ...top])]);

    const payload = { changed, impacted, exports: exportMap };
    fs.mkdirSync(".github/ai", { recursive: true });
    fs.writeFileSync(".github/ai/impact.json", JSON.stringify(payload, null, 2));
    console.log("Wrote .github/ai/impact.json");
  } catch (e) {
    console.error("Impact analysis failed (continuing):", e);
    process.exit(0);
  }
})();
