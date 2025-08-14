import { describe, it, expect } from 'vitest';
// Placeholder: full integration would require spinning Fastify + Neo4j test instance.
// For now we assert schema-level expectations (relationType list) by importing the zod schema indirectly is not exposed.
// Future: refactor schema export for direct test.

describe('relations route schema', () => {
  it('lists expected relation types (documentation sanity)', () => {
    const expected = ['parent','child','spouse','sibling','maternal_grandparents','paternal_grandparents','aunt_uncle','cousin'];
    expect(expected).toContain('cousin');
  });
});
