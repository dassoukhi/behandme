import { jwtVerify, SignJWT } from "jose";

// Service-to-service authentication: a short-lived HS256 token signed with a secret every service
// shares (INTERNAL_JWT_SECRET), for one audience (the called service). Its subject is the user the
// request acts for; the called service trusts it because only the gateway, which authenticated
// that user with Clerk, holds the secret.

const ALGORITHM = "HS256";
const LIFETIME_SECONDS = 60;
export const MIN_SECRET_LENGTH = 32;

export interface InternalCaller {
  /** Service that signed the token. */
  service: string;
  /** User the request is for; null for a request on the service's own behalf. */
  userId: string | null;
}

function key(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `INTERNAL_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signInternalToken(
  secret: string,
  claims: { issuer: string; audience: string; userId: string | null },
): Promise<string> {
  const token = new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(claims.issuer)
    .setAudience(claims.audience)
    .setIssuedAt()
    .setExpirationTime(`${LIFETIME_SECONDS}s`);
  if (claims.userId) token.setSubject(claims.userId);
  return token.sign(key(secret));
}

/** Throws when the token is not signed with `secret`, is expired, or is meant for another service. */
export async function verifyInternalToken(
  secret: string,
  token: string,
  audience: string,
): Promise<InternalCaller> {
  const { payload } = await jwtVerify(token, key(secret), {
    algorithms: [ALGORITHM],
    audience,
    requiredClaims: ["iss", "exp"],
  });
  return { service: payload.iss as string, userId: payload.sub ?? null };
}
