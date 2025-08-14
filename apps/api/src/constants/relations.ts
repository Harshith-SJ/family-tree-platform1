export const RELATION_TYPES = [
  'parent','child','spouse','sibling','maternal_grandparents','paternal_grandparents','aunt_uncle','cousin'
] as const;
export type RelationType = typeof RELATION_TYPES[number];

export const PARENT_LIMIT = 2;

export const GENDER_FEMALE = 'FEMALE';
export const GENDER_MALE = 'MALE';
