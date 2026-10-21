const encoder = new TextEncoder();
const tokenPattern = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

function signingKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function mintToken(secret: string) {
  const spaceId = crypto.getRandomValues(new Uint8Array(16)).toHex();
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, "sign"),
    encoder.encode(spaceId),
  );
  return `${spaceId}.${new Uint8Array(signature).toBase64({ alphabet: "base64url", omitPadding: true })}`;
}

/** Returns the space id when the token was signed with `secret`, otherwise null. */
export async function verifyToken(secret: string, token: string) {
  const [, spaceId, signature] = tokenPattern.exec(token) ?? [];
  if (!spaceId || !signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret, "verify"),
    Uint8Array.fromBase64(signature, { alphabet: "base64url" }),
    encoder.encode(spaceId),
  );
  return valid ? spaceId : null;
}
