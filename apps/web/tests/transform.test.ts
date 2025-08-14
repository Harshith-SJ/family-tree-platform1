import { describe, it, expect } from 'vitest';
import { transform, RawPerson, RawEdge } from '../lib/treev2/transform';

describe('transform', () => {
  it('groups spouses into couple units and centers parent over children', () => {
    const people: RawPerson[] = [
      { id:'p1', name:'Parent1' },
      { id:'p2', name:'Parent2' },
      { id:'c1', name:'Child1' },
      { id:'c2', name:'Child2' }
    ];
    const edges: RawEdge[] = [
      { type:'SPOUSE_OF', sourceId:'p1', targetId:'p2' },
      { type:'PARENT_OF', sourceId:'p1', targetId:'c1' },
      { type:'PARENT_OF', sourceId:'p2', targetId:'c1' },
      { type:'PARENT_OF', sourceId:'p1', targetId:'c2' },
    ];
    const result = transform(people, edges);
    const couple = result.units.find(u=>u.kind==='couple');
    expect(couple).toBeTruthy();
    const childUnits = result.units.filter(u=>u.kind==='single' && (u as any).personId.startsWith('c'));
    expect(childUnits.length).toBe(2);
    // Center check: parent couple x should be <= min child x and >= max child x - width tolerance
    const minChildX = Math.min(...childUnits.map(u=>u.x));
    const maxChildX = Math.max(...childUnits.map(u=>u.x));
    if(couple){
      expect(couple.x).toBeLessThanOrEqual(maxChildX);
      expect(couple.x).toBeGreaterThanOrEqual(minChildX - 10);
    }
  });
});
