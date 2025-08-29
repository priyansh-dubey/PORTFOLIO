// .github/scripts/ai-merge-check.cjs
const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");
const { execSync } = require("child_process");
const fs = require("fs");

const owner = process.env.GITHUB_REPOSITORY.split("/")[0];
const repo = process.env.GITHUB_REPOSITORY.split("/")[1];
const pull_number = process.env.PR_NUMBER;
const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function formatImpact(impact) {
  if (!impact) return "No impact data available.";
  const { changed = [], impacted = [], exports: ex = {} } = impact;
  const lines = [];
  lines.push("Changed files:");
  changed.slice(0, 50).forEach(f => lines.push(`- ${f}`));
  lines.push("");
  lines.push("Potentially impacted (by dependency depth):");
  impacted.slice(0, 50).forEach(i => {
    const exps = (ex[i.file] || []).slice(0, 6).join(", ");
    lines.push(`- d=${i.depth} ${i.file}${exps ? ` (exports: ${exps})` : ""}`);
  });
  return lines.join("\n");
}

async function run() {
  try {
    // 1) Get the diff for this PR
    const diff = execSync(`git diff ${baseSha} ${headSha}`, {
      maxBuffer: 1024 * 1024 * 50,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();

    if (!diff.trim()) {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: "🤖 AI Merge Checker: No code changes detected in diff.",
      });
      console.log("No diff content.");
      return;
    }

    // 2) Limit diff size
    const MAX_CHARS = 40000;
    let truncated = false;
    let diffForAI = diff;
    if (diff.length > MAX_CHARS) {
      diffForAI = diff.slice(0, MAX_CHARS);
      truncated = true;
    }

    // 3) Load impact.json if available
    let impact = null;
    const impactPath = ".github/ai/impact.json";
    if (fs.existsSync(impactPath)) {
      try {
        impact = JSON.parse(fs.readFileSync(impactPath, "utf8"));
      } catch (e) {
        console.warn("Failed to parse impact.json:", e);
      }
    }
    const impactSection = formatImpact(impact);

    // 4) Ask AI to review JS/TS changes + impact
    const prompt = `
You are a senior JavaScript/TypeScript reviewer. We want IMPACT ANALYSIS: which modules, functions, or user-facing features might break.

Inputs:
1) A dependency-based impact list (reverse-deps) with depth and exported symbols.
2) The git diff for this PR (possibly truncated).

Return using this exact template:

Status: (SAFE | RISKY | CRITICAL)

Impact Summary:
- High-risk modules/functions (why)
- User-facing features/routes likely affected
- Data flows/services impacted

Findings:
- Bugs / runtime issues / type errors
- Security or performance concerns
- Backwards-compat issues

Suggested tests (Jest):
- Concrete unit/integration tests to cover risky paths

Mitigations:
- Specific changes or guards to reduce blast radius

--- IMPACT CONTEXT START ---
${impactSection}
--- IMPACT CONTEXT END ---

--- DIFF START ${truncated ? "(TRUNCATED)" : ""} ---
${diffForAI}
--- DIFF END ---
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are an expert JS/TS software engineer and rigorous code reviewer." },
        { role: "user", content: prompt },
      ],
    });

    const aiFeedback = completion.choices?.[0]?.message?.content?.trim() || "No feedback generated.";

    // 5) Post feedback back to the PR
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: `🤖 **AI Merge Checker Report**\n\n${aiFeedback}`,
    });

    console.log("AI feedback posted to PR.");

    // 6) Parse Status from AI output and block on CRITICAL
    const statusMatch = aiFeedback.match(/Status:\s*(SAFE|RISKY|CRITICAL)/i);
    if (statusMatch) {
      const status = statusMatch[1].toUpperCase();
      console.log(`Detected AI status: ${status}`);
      if (status === "CRITICAL") {
        console.error("❌ Merge blocked due to critical issues detected by AI.");
        process.exit(1);
      }
    } else {
      console.warn("⚠️ No Status line found in AI feedback. Defaulting to SAFE.");
    }
  } catch (err) {
    console.error("AI Merge Checker error:", err);
    process.exit(1);
  }
}

run();
