import crypto from "node:crypto";

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

export function sha256Canonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function sha256(input: string | Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
  }
  return "null";
}
