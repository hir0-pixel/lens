import { getConfig } from "../config";
import { createSealedSessionCodec, type SealedSession } from "../utils/crypto";

export interface SessionManager {
  createSession: (value: SealedSession) => string;
  readSession: (cookieValue: string | undefined) => SealedSession | undefined;
  rotateSession: (cookieValue: string | undefined, mutate: (session: SealedSession) => void) => string | undefined;
  revoke: (cookieValue: string | undefined) => void;
  isExpired: (session: SealedSession) => boolean;
  isTokenExpired: (session: SealedSession) => boolean;
}

export function createSessionManager(): SessionManager {
  const cfg = getConfig();
  const codec = createSealedSessionCodec(cfg.SESSION_SECRET);
  const revoked = new Set<string>();

  function createSession(value: SealedSession): string {
    return codec.seal(value);
  }

  function readSession(cookieValue: string | undefined): SealedSession | undefined {
    const session = codec.open(cookieValue);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) return undefined;
    if (revoked.has(session.sid)) return undefined;
    return session;
  }

  function rotateSession(
    cookieValue: string | undefined,
    mutate: (session: SealedSession) => void,
  ): string | undefined {
    const session = codec.open(cookieValue);
    if (!session) return undefined;
    if (revoked.has(session.sid)) return undefined;
    mutate(session);
    return codec.seal(session);
  }

  function revoke(cookieValue: string | undefined): void {
    const session = codec.open(cookieValue);
    if (session) revoked.add(session.sid);
  }

  function isExpired(session: SealedSession): boolean {
    return session.expiresAt <= Date.now();
  }

  function isTokenExpired(session: SealedSession): boolean {
    return session.tokenExpiresAt <= Date.now() + 5_000;
  }

  return {
    createSession,
    readSession,
    rotateSession,
    revoke,
    isExpired,
    isTokenExpired,
  };
}