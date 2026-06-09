#!/usr/bin/env node

// Copies the local Folo CLI session token into a GitHub Actions secret.
// This script intentionally requires an explicit confirmation because it sends
// a local credential to GitHub.

import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir, hostname } from "os";
import { join } from "path";
import { createInterface } from "readline/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = "wadjj/AI-RnD-Digest";
const DEFAULT_SECRET = "FOLO_TOKEN";
const FOLO_CONFIG_PATH = join(homedir(), ".folo", "config.json");
const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const EXPIRES_AT_VARIABLE = "FOLO_TOKEN_EXPIRES_AT";
const SYNCED_AT_VARIABLE = "FOLO_TOKEN_SYNCED_AT";
const SYNCED_BY_VARIABLE = "FOLO_TOKEN_SYNCED_BY";

function parseArgs(argv) {
  const options = {
    repo: DEFAULT_REPO,
    secret: DEFAULT_SECRET,
    minValidDays: 0,
    renewIfNeeded: false,
    loginTimeout: 180,
    pushoverOnLoginNeeded: process.env.PUSHOVER_ON_LOGIN_NEEDED === "1",
    pushoverRetry: Number(process.env.PUSHOVER_RETRY || 60),
    pushoverExpire: Number(process.env.PUSHOVER_EXPIRE || 3600),
    skipIfRemoteValid: process.env.SKIP_IF_REMOTE_VALID === "1",
    force: false,
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
    else if (arg === "--pushover-on-login-needed") options.pushoverOnLoginNeeded = true;
    else if (arg === "--pushover-retry") options.pushoverRetry = Number(argv[++index]);
    else if (arg === "--pushover-expire") options.pushoverExpire = Number(argv[++index]);
    else if (arg === "--skip-if-remote-valid") options.skipIfRemoteValid = true;
    else if (arg === "--force") options.force = true;
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
  --pushover-on-login-needed
                          Send an emergency Pushover alert before launching login
  --pushover-retry <sec>  Emergency retry interval, minimum 30 (default: 60)
  --pushover-expire <sec> Emergency retry duration (default: 3600)
  --skip-if-remote-valid  Skip local work when GitHub secret metadata says the
                          remote token is still valid for --min-valid-days
  --force                 Ignore remote metadata and write the GitHub secret
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

function validatePushoverOptions(options) {
  if (!Number.isFinite(options.pushoverRetry) || options.pushoverRetry < 30) {
    throw new Error("--pushover-retry must be at least 30 seconds for Pushover emergency messages.");
  }
  if (!Number.isFinite(options.pushoverExpire) || options.pushoverExpire <= 0) {
    throw new Error("--pushover-expire must be a positive number.");
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

function formatRemainingDays(expiresAt) {
  const days = remainingDays(expiresAt);
  return days === null ? "unknown" : days.toFixed(1);
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

function getPushoverConfig() {
  const appToken = process.env.PUSHOVER_APP_TOKEN || process.env.PUSHOVER_TOKEN || "";
  const userKey = process.env.PUSHOVER_USER_KEY || process.env.PUSHOVER_USER || "";
  if (!appToken || !userKey) return null;
  return {
    appToken,
    userKey,
    device: process.env.PUSHOVER_DEVICE || "",
    sound: process.env.PUSHOVER_SOUND || "",
  };
}

async function sendPushoverEmergency({ reason, repo, minValidDays, retry, expire }) {
  const config = getPushoverConfig();
  if (!config) {
    console.error(
      "Pushover alert skipped: set PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY to enable it.",
    );
    return;
  }

  const message = [
    "AI R&D Digest needs Folo login before GitHub token sync can continue.",
    "",
    `Reason: ${reason}`,
    `Repo: ${repo}`,
    `Minimum valid days: ${minValidDays}`,
    `Machine: ${process.env.HOSTNAME || "unknown"}`,
  ].join("\n");

  const body = new URLSearchParams({
    token: config.appToken,
    user: config.userKey,
    title: "AI R&D Digest: Folo login needed",
    message,
    priority: "2",
    retry: String(retry),
    expire: String(expire),
    url: "https://github.com/wadjj/AI-RnD-Digest/actions",
    url_title: "Open AI R&D Digest Actions",
  });

  if (config.device) body.set("device", config.device);
  if (config.sound) body.set("sound", config.sound);

  const response = await fetch(PUSHOVER_API_URL, {
    method: "POST",
    body,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== 1) {
    const error = data?.errors ? JSON.stringify(data.errors) : response.statusText;
    throw new Error(`Pushover emergency alert failed: ${error}`);
  }

  console.log(`Pushover emergency alert sent. Receipt: ${data.receipt || "none"}`);
}

async function checkGitHubAccess(repo) {
  await execFileAsync("gh", ["auth", "status"], { timeout: 30000 });
  await execFileAsync("gh", ["repo", "view", repo, "--json", "nameWithOwner"], { timeout: 30000 });
}

async function listGitHubVariables(repo) {
  const { stdout } = await execFileAsync(
    "gh",
    ["variable", "list", "--repo", repo, "--json", "name,value,updatedAt"],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const variables = JSON.parse(stdout);
  return new Map(variables.map((item) => [item.name, item]));
}

async function listGitHubSecrets(repo) {
  const { stdout } = await execFileAsync(
    "gh",
    ["secret", "list", "--repo", repo, "--json", "name,updatedAt"],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const secrets = JSON.parse(stdout);
  return new Map(secrets.map((item) => [item.name, item]));
}

async function getRemoteTokenStatus({ repo, secret, minValidDays }) {
  const [variables, secrets] = await Promise.all([
    listGitHubVariables(repo),
    listGitHubSecrets(repo),
  ]);

  const secretInfo = secrets.get(secret) || null;
  const expiresAt = variables.get(EXPIRES_AT_VARIABLE)?.value || null;
  const syncedAt = variables.get(SYNCED_AT_VARIABLE)?.value || null;
  const syncedBy = variables.get(SYNCED_BY_VARIABLE)?.value || null;
  const problem = secretInfo
    ? validDaysProblem({ expiresAt, minValidDays })
    : `GitHub secret ${secret} does not exist.`;

  return {
    hasSecret: Boolean(secretInfo),
    expiresAt,
    syncedAt,
    syncedBy,
    problem: expiresAt ? problem : problem || `${EXPIRES_AT_VARIABLE} is missing.`,
  };
}

async function setGitHubVariable({ repo, name, value }) {
  await execFileAsync("gh", ["variable", "set", name, "--repo", repo, "--body", value], {
    timeout: 30000,
  });
}

async function writeRemoteTokenMetadata({ repo, expiresAt }) {
  const now = new Date().toISOString();
  const host = hostname();
  await setGitHubVariable({ repo, name: EXPIRES_AT_VARIABLE, value: expiresAt || "" });
  await setGitHubVariable({ repo, name: SYNCED_AT_VARIABLE, value: now });
  await setGitHubVariable({ repo, name: SYNCED_BY_VARIABLE, value: host });
  console.log(`GitHub token metadata updated: expiresAt=${expiresAt || "unknown"}, syncedBy=${host}`);
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
  validatePushoverOptions(options);

  await checkGitHubAccess(options.repo);

  if (options.skipIfRemoteValid && !options.force) {
    const remote = await getRemoteTokenStatus({
      repo: options.repo,
      secret: options.secret,
      minValidDays: options.minValidDays,
    });

    if (remote.hasSecret && remote.expiresAt && !remote.problem) {
      console.log(
        [
          `GitHub secret ${options.secret} is already recorded as valid.`,
          `Expires at: ${remote.expiresAt} (${formatRemainingDays(remote.expiresAt)} days remaining)`,
          `Last synced at: ${remote.syncedAt || "unknown"}`,
          `Last synced by: ${remote.syncedBy || "unknown"}`,
          "Skipping local Folo token sync.",
        ].join("\n"),
      );
      return;
    }

    console.log(
      `Remote GitHub token sync is needed: ${remote.problem || "metadata missing or not valid enough"}`,
    );
  }

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
    if (options.pushoverOnLoginNeeded) {
      await sendPushoverEmergency({
        reason: loginReason,
        repo: options.repo,
        minValidDays: options.minValidDays,
        retry: options.pushoverRetry,
        expire: options.pushoverExpire,
      });
    }
    await runFoloLogin(options.loginTimeout);
    folo = await loadFoloConfig();
    session = await getValidFoloSession(folo, options.minValidDays);
  }

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
  await writeRemoteTokenMetadata({
    repo: options.repo,
    expiresAt,
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
