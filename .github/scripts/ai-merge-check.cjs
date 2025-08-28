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
      maxBuffer: 1024 * 1024 * 50, // up to ~50MB
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

    // 2) Keep payload reasonable for the model
    const MAX_CHARS = 40000; // MVP: trim if too large
    let truncated = false;
    let diffForAI = diff;
    if (diff.length > MAX_CHARS) {
      diffForAI = diff.slice(0, MAX_CHARS);
      truncated = true;
    }

    // 3) Ask the AI to review the changes
    const prompt = `
You are a senior code reviewer. Analyze the following git diff and produce:
- Key risks/bugs introduced
- Security or performance concerns
- Backwards-compatibility issues
- Concrete test cases to add

Return using this exact template:

Status: (SAFE | RISKY | CRITICAL)
Findings:
- bullet points...
Suggested tests:
- bullet points...
Notes:
- bullet points (if any)

Repo: ${owner}/${repo}
PR: #${pull_number}
Diff${truncated ? " (TRUNCATED)" : ""}:
${diffForAI}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are an expert software engineer and rigorous code reviewer." },
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
  } catch (err) {
    console.error("AI Merge Checker error:", err);
    // Fail the job only if you want the status check to show as failed.
    // For MVP, we'll still pass but log the error.
  }
}

run();
