// sanitize.js
import path from "path";
import cron from "node-cron";
import { logConsoleOutput } from "./logs.js";

// Token
function sanitizeToken(token) {
  if (typeof token !== "string") throw new Error("Invalid token: must be a string");
  if (token.length < 42) throw new Error("Invalid token: too short");
  if (!token.includes("=")) throw new Error("Invalid token: missing '='");
  if (token.includes(" ")) throw new Error("Invalid token: contains spaces");
  return token;
}

// Instance URL
function sanitizeInstance(instance) {
  if (typeof instance !== "string") throw new Error("Invalid instance: must be a string");
  if (instance.includes(" ")) throw new Error("Invalid instance: contains spaces");
  const regex = /^https?:\/\/[^/]+$/;
  if (!regex.test(instance)) throw new Error("Invalid instance: must start with http(s):// and no path\n tip: you might have a trailing slash");
  return instance;
}

// Paths
// all the other functions throw if invalid, so this is the only one that needs to be exported
export async function sanitizePath(p) {
  if (typeof p !== "string") throw new Error("Invalid path: must be a string");
  return path.resolve(p.replace(/\\/g, "/"));
}

// Cron
function sanitizeCron(cronExpr) {
  if (typeof cronExpr !== "string") throw new Error("Invalid cron: must be a string");
  if (cronExpr === "" || cronExpr === " " ) return ""; // allow empty cron to disable scheduling
  if (!cron.validate(cronExpr)) throw new Error("Invalid cron: failed validation");
  return cronExpr;
}

// Main
export async function sanitizeConfig(input) {
  const output = { ...input }; // shallow copy

  if ("token" in input) output.token = sanitizeToken(input.token);
  if ("instance" in input) output.instance = sanitizeInstance(input.instance);
  if ("export_dir" in input) output.export_dir = sanitizePath(input.export_dir);
  if ("freetube_dir" in input) output.freetube_dir = sanitizePath(input.freetube_dir);
  if ("cron_schedule" in input) output.cron_schedule = sanitizeCron(input.cron_schedule);

  return output;
}
// just logs whatever is in the console to a file
logConsoleOutput();