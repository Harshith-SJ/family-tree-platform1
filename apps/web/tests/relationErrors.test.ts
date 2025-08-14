import { describe, it, expect } from 'vitest';
import { mapRelationError } from '../lib/relationErrors';

describe('mapRelationError', () => {
  it('maps known codes', () => {
    expect(mapRelationError('LIMIT')).toContain('Limit');
    expect(mapRelationError('DUPLICATE')).toContain('Email');
    expect(mapRelationError('MISSING_PARENT')).toContain('parent');
  });
  it('returns null for unknown', () => {
    expect(mapRelationError('NOT_A_CODE')).toBeNull();
  });
});
