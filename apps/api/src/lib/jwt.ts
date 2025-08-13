import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export type JwtPayload = { sub: string; email: string };

export function signToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as unknown as number } as SignOptions;
  return jwt.sign(payload, env.JWT_SECRET, opts);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
