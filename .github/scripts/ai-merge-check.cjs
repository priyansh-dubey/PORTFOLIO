// .github/scripts/ai-merge-check.cjs
const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");
const { execSync } = require("child_process");

const owner = process.env.GITHUB_REPOSITORY.split("/")[0];
const repo = process.env.GITHUB_REPOSITORY.split("/")[1];
const pull_number = process.env.PR_NUMBER;
const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    // 3) Ask AI to review JS/TS changes
    const prompt = `
    You are a senior JavaScript/TypeScript code reviewer. 
    You MUST analyze the following git diff and produce:

    Status: (SAFE | RISKY | CRITICAL)

    Findings:
    - Point out possible bugs, type errors, or runtime issues
    - Security concerns (e.g., XSS, SQL injection, unsafe eval)
    - Performance issues (e.g., nested loops, blocking async calls)
    - Backwards-compatibility issues with TypeScript types or APIs

    Suggested tests (using Jest):
    - List concrete unit/integration test cases we should add
    - Example: edge cases, error handling, async scenarios

    Lint/Type Suggestions:
    - Highlight any ESLint/Prettier style or TypeScript typing improvements
    - Example: missing return types, unsafe any, unused variables

    Notes:
    - Add extra advice only if important

    Repo: ${owner}/${repo}
    PR: #${pull_number}
    Diff${truncated ? " (TRUNCATED)" : ""}:
    ${diffForAI}
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

    // 4) Post feedback back to the PR
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: `🤖 **AI Merge Checker Report**\n\n${aiFeedback}`,
    });

    console.log("AI feedback posted to PR.");

    // 5) Parse Status from AI output
    const statusMatch = aiFeedback.match(/Status:\s*(SAFE|RISKY|CRITICAL)/i);
    if (statusMatch) {
      const status = statusMatch[1].toUpperCase();
      console.log(`Detected AI status: ${status}`);
      if (status === "CRITICAL") {
        console.error("❌ Merge blocked due to critical issues detected by AI.");
        process.exit(1); // Fail the GitHub Action job
      }
    } else {
      console.warn("⚠️ No Status line found in AI feedback. Defaulting to SAFE.");
    }
  } catch (err) {
    console.error("AI Merge Checker error:", err);
    process.exit(1); // Fail the job if script itself crashes
  }
}

run();
