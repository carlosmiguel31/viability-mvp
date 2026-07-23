import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { UserRole } from "../generated/prisma/enums";

export interface AccessTokenPayload {
  sub: string; // user id
  /** Familia de sessao: permite invalidar o access token junto com o refresh. */
  familyId: string;
  role: UserRole;
  name: string;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  jti: string; // id do registro persistido (hash em refresh_tokens)
  familyId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const { sub, ...rest } = payload;
  return jwt.sign(rest, env.JWT_ACCESS_SECRET, {
    subject: sub,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  return {
    sub: String(decoded.sub),
    familyId: String(decoded.familyId),
    role: decoded.role,
    name: decoded.name,
    email: decoded.email,
  };
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(
    { familyId: payload.familyId },
    env.JWT_REFRESH_SECRET,
    {
      subject: payload.sub,
      jwtid: payload.jti,
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    }
  );
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  return { sub: String(decoded.sub), jti: String(decoded.jti), familyId: decoded.familyId };
}
