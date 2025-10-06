// src/encryption.js
import crypto from "crypto";
import keytar from "keytar";
import readline from "readline";
import { log } from "./logs.js";

const SERVICE = "ft-to-inv";
const ACCOUNT = "tokenKey";
const ALGO = "aes-256-gcm";

/**
 * Derive a key from the passphrase.
 */
// Secure key derivation using PBKDF2
function getKey(passphrase, salt) {
  // 600,000 iterations, 32-byte key length, SHA-256 digest
  return crypto.pbkdf2Sync(passphrase, salt, 600000, 32, "sha256");
}

/**
 * Encrypt a token with the given passphrase.
 */
export async function encryptToken(token, passphrase) {
  const iv = crypto.randomBytes(16);
  const salt = crypto.randomBytes(16); // New random salt
  const key = getKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  // Include salt in the encrypted token format
  return `${iv.toString("hex")}:${salt.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * Decrypt a token with the given passphrase.
 */
export async function decryptToken(enc, passphrase) {
  try {
    const parts = enc.split(":");
    // New format expects 4 fields: iv:salt:tag:data
    if (parts.length !== 4) throw new Error("Invalid encrypted token format");
    const [ivHex, saltHex, tagHex, data] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const salt = Buffer.from(saltHex, "hex");
    const key = getKey(passphrase, salt);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Try to get the passphrase from keytar, fallback to prompt or env var.
 */
export async function getPassphrase() {
  // Try system keychain
  let passphrase = await keytar.getPassword(SERVICE, ACCOUNT);

  if (passphrase) return passphrase;

  // Fallback: env var
  if (process.env.FT_INV_KEY) {
    passphrase = process.env.FT_INV_KEY;
    await keytar.setPassword(SERVICE, ACCOUNT, passphrase);
    return passphrase;
  }

  // Last resort: prompt user
  passphrase = await prompt("Enter a passphrase to secure your token: ");
  if (!passphrase) {
    passphrase = "ilikewaffles" + crypto.randomBytes(8).toString("hex");
    log("⚠️  No passphrase entered, generated one automatically. You should change this later.", { err: 'warning' });
  }
  await keytar.setPassword(SERVICE, ACCOUNT, passphrase);
  return passphrase;
}

/**
 * Encrypt and rewrite plaintext tokens in config.
 */
export async function migrateToken(configPath, config) {
  if (typeof config.token !== "string" || config.token.includes(":")) {
    return config; // already encrypted or invalid
  }

  log("⚠️  Found plaintext token in config. Migrating...", { err: 'warning' });
  const passphrase = await getPassphrase();
  const encrypted = encryptToken(config.token, passphrase);
  config.token = encrypted;

  // Save back to file
  const fs = await import("fs");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  log("✅ Token encrypted and config updated.", { err: 'info' });

  return config;
}

/**
 * Decrypt a token from config.
 */
export async function loadToken(token) {
  const raw = token;
  if (typeof raw !== "string") throw new Error("No token found in config");

  // Encrypted token
  if (raw.includes(":")) {
    const passphrase = await getPassphrase();
    const decrypted = decryptToken(raw, passphrase);
    if (!decrypted) throw new Error("Failed to decrypt token. Wrong key?");
    return decrypted;
  }

  // Plaintext token (legacy)
  log("⚠️ Using plaintext token. Run `ft-to-inv encrypt-token` to secure it.", { err: 'warning' });
  return raw;
}

/**
 * Simple readline prompt helper.
 */
function prompt(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans.trim()); }));
}
