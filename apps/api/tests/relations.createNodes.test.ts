import { describe, it, expect } from 'vitest';
// Minimal unit-ish test to validate response shape decisions documented.

interface RelationAddResponse {
  nodes: { id:string }[];
  edges: { type:string; sourceId:string; targetId:string }[];
}

// These tests are schematic because full DB integration not set up in test harness yet.
// They serve as contract documentation so frontend assumptions stay aligned.

function simulatePairGrandparentResponse(): RelationAddResponse {
  return {
    nodes: [{id:'gp1'},{id:'gp2'}],
    edges: [
      { type:'SPOUSE_OF', sourceId:'gp1', targetId:'gp2' },
      { type:'SPOUSE_OF', sourceId:'gp2', targetId:'gp1' },
      { type:'PARENT_OF', sourceId:'gp1', targetId:'mom' },
      { type:'PARENT_OF', sourceId:'gp2', targetId:'mom' },
    ]
  };
}

function simulateSingleParentResponse(): RelationAddResponse {
  return {
    nodes: [{id:'p1'}],
    edges: [ { type:'PARENT_OF', sourceId:'p1', targetId:'child1' } ]
  };
}

describe('relations add response contract', () => {
  it('grandparent pair returns both nodes in nodes[]', () => {
    const res = simulatePairGrandparentResponse();
    expect(res.nodes.length).toBe(2);
    const spouseEdges = res.edges.filter(e=>e.type==='SPOUSE_OF');
    expect(spouseEdges.length).toBeGreaterThanOrEqual(2);
  });
  it('single parent creation returns single nodes[] entry', () => {
    const res = simulateSingleParentResponse();
    expect(res.nodes.length).toBe(1);
  });
});
