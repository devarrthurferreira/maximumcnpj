import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function token(): string { return randomBytes(32).toString('base64url'); }
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AppError(400, 'PASSWORD_POLICY', 'A senha deve ter entre 12 e 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: unknown, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [type, salt, hex] = stored.split(':');
  if (type !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/.test(hex ?? '')) return false;
  const key = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export class AppError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function need(condition: unknown, message: string, status = 400, code = 'VALIDATION'): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export function text(value: unknown, max = 160): string {
  need(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'Texto ausente ou acima do limite.');
  return value.trim();
}
export function email(value: unknown): string { const v = text(value, 254).toLowerCase(); need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'E-mail inválido.'); return v; }
export function integer(value: unknown, min: number, max: number): number { const n = Number(value); need(Number.isInteger(n) && n >= min && n <= max, 'Número fora do limite.'); return n; }
export function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
