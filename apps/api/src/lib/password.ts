export function validatePassword(pwd: string): string | null {
  if (!pwd) return 'Password required';
  if (pwd.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return 'Password must contain letters and numbers';
  return null;
}

export function enforcePassword(pwd: string) {
  const err = validatePassword(pwd);
  if (err) throw new Error(err);
}
