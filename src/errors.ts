export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.name = 'AppError'; this.status = status; this.code = code;
  }
}
export function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new AppError(400, 'VALIDATION', message);
}
export function textInput(value: unknown, name: string, max = 200): string {
  const text = typeof value === 'string' ? value.trim() : '';
  requireValue(text.length > 0 && text.length <= max, `${name} is required (maximum ${max} characters).`);
  return text;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  requireValue(value !== '' && value !== undefined && value !== null, `${name} is required.`);
  const n = Number(value);
  requireValue(Number.isSafeInteger(n) && n >= min && n <= max, `${name} must be a whole number between ${min} and ${max}.`);
  return n;
}
export function emailInput(value: unknown): string {
  const email = textInput(value, 'Email', 254);
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  return email;
}
