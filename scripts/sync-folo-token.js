#!/usr/bin/env node

// Copies the local Folo CLI session token into a GitHub Actions secret.
// This script intentionally requires an explicit confirmation because it sends
// a local credential to GitHub.

import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = "wadjj/AI-RnD-Digest";
const DEFAULT_SECRET = "FOLO_TOKEN";
const FOLO_CONFIG_PATH = join(homedir(), ".folo", "config.json");

function parseArgs(argv) {
  const options = {
    repo: DEFAULT_REPO,
    secret: DEFAULT_SECRET,
    minValidDays: 0,
    renewIfNeeded: false,
    loginTimeout: 180,
    yes: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") options.repo = argv[++index];
    else if (arg === "--secret") options.secret = argv[++index];
    else if (arg === "--min-valid-days") options.minValidDays = Number(argv[++index]);
    else if (arg === "--renew-if-needed") options.renewIfNeeded = true;
    else if (arg === "--login-timeout") options.loginTimeout = Number(argv[++index]);
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run sync:folo-token -- [options]

Options:
  --repo <owner/name>     GitHub repository (default: ${DEFAULT_REPO})
  --secret <name>         GitHub secret name (default: ${DEFAULT_SECRET})
  --min-valid-days <n>    Fail if the Folo session expires sooner than n days
  --renew-if-needed       Run "folocli login" before syncing when token is missing,
                          invalid, or below --min-valid-days
  --login-timeout <sec>   Browser login timeout in seconds (default: 180)
  --dry-run               Validate local token and GitHub CLI without writing
  --yes, -y               Skip interactive confirmation
`);
}

function validateRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid repo: ${repo}`);
  }
}

function validateSecretName(secret) {
  if (!/^[A-Z0-9_]+$/.test(secret)) {
    throw new Error(`Invalid secret name: ${secret}. Use uppercase letters, digits, and underscores.`);
  }
}

function validateMinValidDays(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("--min-valid-days must be a non-negative number.");
  }
}

function validateLoginTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("--login-timeout must be a positive number.");
  }
}

async function tryLoadFoloConfig() {
  if (!existsSync(FOLO_CONFIG_PATH)) {
    return null;
  }

  const config = JSON.parse(await readFile(FOLO_CONFIG_PATH, "utf-8"));
  if (!config.token || typeof config.token !== "string") {
    return null;
  }

  return {
    apiUrl: config.apiUrl || "https://api.folo.is",
    token: config.token,
  };
}

async function loadFoloConfig() {
  const config = await tryLoadFoloConfig();
  if (!config) {
    throw new Error(`Missing Folo token in ${FOLO_CONFIG_PATH}. Run "npx --yes folocli@latest login" first.`);
  }
  return config;
}

async function fetchFoloSession({ apiUrl, token }) {
  const response = await fetch(`${apiUrl}/better-auth/get-session`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: `__Secure-better-auth.session_token=${token}; better-auth.session_token=${token}`,
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Folo token is invalid or expired: HTTP ${response.status} ${message}`.trim());
  }

  const data = await response.json();
  if (!data?.session || !data?.user) {
    throw new Error("Folo token check did not return a valid session.");
  }
  return data.session;
}

function remainingDays(expiresAt) {
  if (!expiresAt) return null;
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs)) return null;
  return remainingMs / 86400000;
}

function validDaysProblem({ expiresAt, minValidDays }) {
  if (!expiresAt || minValidDays <= 0) return null;
  const days = remainingDays(expiresAt);
  if (days === null) return `Folo token has an unreadable expiresAt value: ${expiresAt}`;
  if (days < minValidDays) {
    return `Folo token expires too soon (${days.toFixed(1)} days remaining, minimum ${minValidDays}).`;
  }
  return null;
}

async function getValidFoloSession(folo, minValidDays) {
  const session = await fetchFoloSession(folo);
  const expiresAt = session.expiresAt || session.expires || null;
  const problem = validDaysProblem({ expiresAt, minValidDays });
  if (problem) throw new Error(problem);
  return session;
}

async function runFoloLogin(timeoutSeconds) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["--yes", "folocli@latest", "login", "--timeout", String(timeoutSeconds)],
      {
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`folocli login exited with code ${code}`));
    });
  });
}

async function checkGitHubAccess(repo) {
  await execFileAsync("gh", ["auth", "status"], { timeout: 30000 });
  await execFileAsync("gh", ["repo", "view", repo, "--json", "nameWithOwner"], { timeout: 30000 });
}

async function confirmWrite({ repo, secret, expiresAt }) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      [
        "",
        `This will upload your local Folo session token to GitHub Actions secret ${secret}.`,
        `Target repo: ${repo}`,
        `Token expires at: ${expiresAt || "unknown"}`,
        "Type yes to continue: ",
      ].join("\n"),
    );
    return answer.trim() === "yes";
  } finally {
    rl.close();
  }
}

async function setGitHubSecret({ repo, secret, token }) {
  await new Promise((resolve, reject) => {
    const child = spawn("gh", ["secret", "set", secret, "--repo", repo], {
      stdio: ["pipe", "inherit", "inherit"],
    });

    child.stdin.end(token);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh secret set exited with code ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateRepo(options.repo);
  validateSecretName(options.secret);
  validateMinValidDays(options.minValidDays);
  validateLoginTimeout(options.loginTimeout);

  let folo = await tryLoadFoloConfig();
  let session;
  let loginReason = null;

  if (!folo) {
    loginReason = `Missing Folo token in ${FOLO_CONFIG_PATH}.`;
  } else {
    try {
      session = await getValidFoloSession(folo, options.minValidDays);
    } catch (error) {
      loginReason = error.message;
    }
  }

  if (loginReason) {
    if (!options.renewIfNeeded) {
      throw new Error(`${loginReason} Run "npx --yes folocli@latest login" first, or rerun this script with --renew-if-needed.`);
    }
    if (options.dryRun) {
      throw new Error(`${loginReason} Dry run will not launch login; rerun without --dry-run to renew.`);
    }

    console.log(`${loginReason} Starting Folo login...`);
    await runFoloLogin(options.loginTimeout);
    folo = await loadFoloConfig();
    session = await getValidFoloSession(folo, options.minValidDays);
  }

  await checkGitHubAccess(options.repo);

  const expiresAt = session.expiresAt || session.expires || null;
  console.log(`Folo token is valid. Expires at: ${expiresAt || "unknown"}`);
  console.log(`GitHub repo is accessible: ${options.repo}`);
  console.log(`Secret target: ${options.secret}`);

  if (options.dryRun) {
    console.log("Dry run only. No secret was written.");
    return;
  }

  const confirmed = options.yes || (await confirmWrite({
    repo: options.repo,
    secret: options.secret,
    expiresAt,
  }));

  if (!confirmed) {
    console.log("Canceled. No secret was written.");
    return;
  }

  await setGitHubSecret({
    repo: options.repo,
    secret: options.secret,
    token: folo.token,
  });
  console.log(`GitHub secret ${options.secret} updated for ${options.repo}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
