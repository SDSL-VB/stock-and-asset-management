import crypto from "crypto";

/**
 * Reversible encryption for the stored password mirror.
 *
 * Login always verifies against the bcrypt `password` column — this module only
 * powers the "reveal password" capability (permission `users.password.view`),
 * so an admin can read back a password that was set through the app.
 *
 * Key resolution, in order:
 *   1. PASSWORD_ENCRYPTION_KEY — 64 hex chars (32 bytes). The recommended setup.
 *   2. NEXTAUTH_SECRET — derived via scrypt so the feature works without extra
 *      configuration on existing deployments.
 * If neither is set, encryption is disabled: passwords are still hashed and
 * saved normally, they just cannot be revealed later.
 *
 * Rotating the key does not break anything — previously stored values simply
 * fail to decrypt and are reported as unavailable.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getKey(): Buffer | null {
  const explicit = process.env.PASSWORD_ENCRYPTION_KEY;
  if (explicit) {
    const trimmed = explicit.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, "hex");
    }
    // Any other non-empty value is stretched to 32 bytes rather than rejected
    return crypto.scryptSync(trimmed, "sam-password-vault", 32);
  }

  const fallback = process.env.NEXTAUTH_SECRET;
  if (fallback) {
    return crypto.scryptSync(fallback, "sam-password-vault", 32);
  }

  return null;
}

/** Whether the server is configured to store recoverable passwords at all. */
export function isPasswordVaultEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Encrypts a plaintext password. Returns null when no key is configured, in
 * which case callers simply store nothing (the password stays write-only).
 */
export function encryptPassword(plaintext: string): string | null {
  const key = getKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a stored value. Returns null for anything that cannot be read back
 * (no key configured, malformed payload, or a value written under a different
 * key) so callers can fall back to "not available".
 */
export function decryptPassword(payload: string | null | undefined): string | null {
  if (!payload) return null;

  const key = getKey();
  if (!key) return null;

  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
