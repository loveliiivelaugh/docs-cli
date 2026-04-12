import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".config", "docs-cli");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

function sanitizeConfig(config) {
  return {
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    baseUrl:
      typeof config.baseUrl === "string" && config.baseUrl.trim()
        ? config.baseUrl.trim()
        : DEFAULT_BASE_URL,
    lastVerifiedAt:
      typeof config.lastVerifiedAt === "string" ? config.lastVerifiedAt : null,
  };
}

export function getConfigPath() {
  return CONFIG_PATH;
}

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL;
}

export async function loadConfig() {
  try {
    const contents = await fs.readFile(CONFIG_PATH, "utf8");
    return sanitizeConfig(JSON.parse(contents));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return sanitizeConfig({});
    }

    throw new Error(`Failed to read config at ${CONFIG_PATH}: ${error.message}`);
  }
}

export async function saveConfig(config) {
  const nextConfig = sanitizeConfig(config);
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.chmod(CONFIG_PATH, 0o600);
  return nextConfig;
}

export async function clearConfig() {
  try {
    await fs.unlink(CONFIG_PATH);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw new Error(`Failed to clear config at ${CONFIG_PATH}: ${error.message}`);
    }
  }
}
