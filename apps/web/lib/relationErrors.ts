export function mapRelationError(code?: string | null): string | null {
  if(!code) return null;
  const map: Record<string,string> = {
    LIMIT: 'Limit reached for this relation type.',
    DUPLICATE: 'Email already exists. Use a different email.',
    MISSING_PARENT: 'Required parent missing. Add the parent first.',
    MISSING_GRANDPARENT: 'Grandparent prerequisite missing. Add grandparents first.',
    VALIDATION: 'Validation failed or prerequisite not met.',
    WEAK_PASSWORD: 'Password does not meet strength requirements.'
  };
  return map[code] || null;
}

export function mapErrorObject(err: any): string | null {
  return mapRelationError(err?.code || err?.raw?.code);
}
