import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { errorHandlingPlugin } from '../src/plugins/errorHandler';
import { env } from '../src/config/env';
import { getDriver, closeDriver } from '../src/lib/neo4j';

// NOTE: This test assumes a Neo4j instance is available via env vars pointing to a disposable database.
// For full isolation, integrate testcontainers-neo4j. Placeholder minimal integration.

let app: any;

// Helper seed utilities
async function runCypher(statements: string[]) {
  const session = getDriver().session();
  try { for (const s of statements) { await session.run(s); } } finally { await session.close(); }
}

async function seedLinear(ids: { gp?: string; parent?: string; child: string; parentGender?: 'MALE'|'FEMALE' }, side: 'maternal'|'paternal') {
  const { gp, parent, child, parentGender } = ids;
  const gender = parentGender || (side === 'maternal' ? 'FEMALE' : 'MALE');
  const chain = [] as string[];
  if (gp && parent) {
    chain.push(`CREATE (gp:Person { id:'${gp}', name:'${gp}', password:'x' })-[:PARENT_OF]->(par:Person { id:'${parent}', name:'${parent}', gender:'${gender}', password:'x' })-[:PARENT_OF]->(c:Person { id:'${child}', name:'${child}', password:'x' })`);
  } else if (parent) {
    chain.push(`CREATE (par:Person { id:'${parent}', name:'${parent}', gender:'${gender}', password:'x' })-[:PARENT_OF]->(c:Person { id:'${child}', name:'${child}', password:'x' })`);
  } else {
    chain.push(`CREATE (c:Person { id:'${child}', name:'${child}', password:'x' })`);
  }
  await runCypher(chain);
}

async function clearDb() {
  const session = getDriver().session();
  try { await session.run('MATCH (n:Person) DETACH DELETE n'); } finally { await session.close(); }
}

describe.sequential('integration: relations add basic flow', () => {
  beforeAll(async () => {
    // Disable debug logs unless explicitly turned on outside tests
    process.env.DEBUG_RELATIONS = process.env.DEBUG_RELATIONS || '0';
    app = Fastify();
    await app.register(errorHandlingPlugin);
    // Directly register route handler function (import handler logic) w/out auth.
    const { registerRelationRoutes } = await import('../src/routes/relations');
    // Wrap requireAuth by decorating request before it runs
    await app.register(async function(fakeAuth){
      fakeAuth.addHook('preHandler', (req:any,_res,done)=>{ req.user={ sub:'test', email:'t@example.com'}; done(); });
      await registerRelationRoutes(fakeAuth as any);
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeDriver();
  });

  beforeEach(async () => {
    await clearDb();
  });

  it('creates parent then child and returns edges containing PARENT_OF', async () => {
    const session = getDriver().session();
    try {
      await session.run("CREATE (p:Person { id:'ref1', name:'Ref', password:'x' })");
    } finally { await session.close(); }

  const parentResp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'ref1', relationType:'parent', person:{ name:'ParentA', email:'a@example.com', tempPassword:'password1' } } });
  if(parentResp.statusCode!==201){
    console.error('parentResp body', parentResp.body);
  }
  expect(parentResp.statusCode).toBe(201);
  const parentBody = parentResp.json();
  expect(parentBody.nodes.length).toBe(1);

  const childResp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'ref1', relationType:'child', person:{ name:'Child1', email:'c@example.com', tempPassword:'password2' } } });
  if(childResp.statusCode!==201){
    console.error('childResp body', childResp.body);
  }
  expect(childResp.statusCode).toBe(201);
    const childBody = childResp.json();
    const parentEdges = childBody.edges.filter((e:any)=> e.type==='PARENT_OF');
    expect(parentEdges.length).toBeGreaterThan(0);
  });

  it('creates maternal grandparent pair and returns two nodes plus spouse edges', async () => {
    await seedLinear({ parent:'mom1', child:'refG1', parentGender:'FEMALE' }, 'maternal');
    const payload = { referenceId:'refG1', relationType:'maternal_grandparents', person:{ name:'Gma', email:'gma@example.com', gender:'FEMALE', tempPassword:'password3' }, partner:{ name:'Gpa', email:'gpa@example.com', gender:'MALE', tempPassword:'password4' }, options:{ createPair:true } };
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload });
    if(resp.statusCode!==201){ console.error('grandparentsResp debug', { status: resp.statusCode, body: resp.body, payload }); }
    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    expect(body.nodes.length).toBe(2);
  const spouseEdges = body.edges.filter((e:any)=> e.type==='SPOUSE_OF');
  const uniqueDirs = new Set(spouseEdges.map((e:any)=> e.sourceId+'=>'+e.targetId));
  expect(uniqueDirs.size).toBe(2); // both directions present
  expect(spouseEdges.length).toBeGreaterThanOrEqual(2); // allow duplication layer
  });

  it('creates spouse and ensures bidirectional SPOUSE_OF edges returned', async () => {
  const session = getDriver().session();
  try { await session.run("CREATE (p:Person { id:'refS1', name:'Solo', password:'x' })"); } finally { await session.close(); }
  const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refS1', relationType:'spouse', person:{ name:'Partner', email:'partner@example.com', gender:'FEMALE', tempPassword:'password5' } } });
    if(resp.statusCode!==201){
      console.error('spouseResp body', resp.body);
    }
    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    const spouseEdges = body.edges.filter((e:any)=> e.type==='SPOUSE_OF');
    // Should include both directions
    expect(spouseEdges.length).toBe(2);
    const dirSet = new Set(spouseEdges.map((e:any)=> e.sourceId+'=>'+e.targetId));
    expect(dirSet.size).toBe(2);
  });

  it('creates paternal grandparent pair', async () => {
    await seedLinear({ parent:'dad1', child:'refPG1', parentGender:'MALE' }, 'paternal');
    const payload = { referenceId:'refPG1', relationType:'paternal_grandparents', person:{ name:'Gpa', email:'gpa2@example.com', gender:'MALE', tempPassword:'password6' }, partner:{ name:'Gma', email:'gma2@example.com', gender:'FEMALE', tempPassword:'password7' }, options:{ createPair:true } };
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload });
    if(resp.statusCode!==201){ console.error('paternalGrandparentsResp body', resp.body); }
    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    expect(body.nodes.length).toBe(2);
  const spouseEdges = body.edges.filter((e:any)=> e.type==='SPOUSE_OF');
  const uniqueDirs = new Set(spouseEdges.map((e:any)=> e.sourceId+'=>'+e.targetId));
  expect(uniqueDirs.size).toBe(2);
  expect(spouseEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('creates sibling attached to existing parent(s)', async () => {
    await seedLinear({ parent:'parent1', child:'refSib1' }, 'maternal');
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refSib1', relationType:'sibling', person:{ name:'SiblingA', email:'sib@example.com', tempPassword:'password8' } } });
    if(resp.statusCode!==201){ console.error('siblingResp body', resp.body); }
    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    expect(body.nodes.length).toBe(1);
    const newId = body.nodes[0].id;
    const parentEdges = body.edges.filter((e:any)=> e.type==='PARENT_OF' && e.targetId === newId);
    expect(parentEdges.length).toBeGreaterThan(0);
  });

  it('creates aunt (maternal) then cousin through that aunt', async () => {
    await seedLinear({ gp:'gpC1', parent:'momC1', child:'refC1', parentGender:'FEMALE' }, 'maternal');
    const auntResp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refC1', relationType:'aunt_uncle', person:{ name:'Aunt1', email:'aunt1@example.com', tempPassword:'password9' }, options:{ side:'maternal' } } });
    if(auntResp.statusCode!==201){ console.error('auntResp body', auntResp.body); }
    expect(auntResp.statusCode).toBe(201);
    const auntBody = auntResp.json();
    const auntId = auntBody.nodes[0].id;
    const cousinResp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refC1', relationType:'cousin', person:{ name:'Cousin1', email:'cousin1@example.com', tempPassword:'password10' }, options:{ uncleAuntId: auntId } } });
    if(cousinResp.statusCode!==201){ console.error('cousinResp body', cousinResp.body); }
    expect(cousinResp.statusCode).toBe(201);
    const cousinBody = cousinResp.json();
    expect(cousinBody.nodes.length).toBe(1);
    const cId = cousinBody.nodes[0].id;
    const parentEdges = cousinBody.edges.filter((e:any)=> e.type==='PARENT_OF' && e.targetId === cId);
    expect(parentEdges.length).toBe(1);
  });

  it('creates uncle (paternal) then cousin through that uncle', async () => {
    await seedLinear({ gp:'gpPC1', parent:'dadPC1', child:'refPC1', parentGender:'MALE' }, 'paternal');
    const uncleResp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refPC1', relationType:'aunt_uncle', person:{ name:'Uncle1', email:'uncle1@example.com', tempPassword:'password11' }, options:{ side:'paternal' } } });
    if(uncleResp.statusCode!==201){ console.error('uncleResp body', uncleResp.body); }
    expect(uncleResp.statusCode).toBe(201);
    const uncleBody = uncleResp.json();
    const uncleId = uncleBody.nodes[0].id;
    const cousinResp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refPC1', relationType:'cousin', person:{ name:'CousinP1', email:'cousinp1@example.com', tempPassword:'password12' }, options:{ uncleAuntId: uncleId } } });
    if(cousinResp.statusCode!==201){ console.error('cousinPResp body', cousinResp.body); }
    expect(cousinResp.statusCode).toBe(201);
    const cousinBody = cousinResp.json();
    expect(cousinBody.nodes.length).toBe(1);
    const cId = cousinBody.nodes[0].id;
    const parentEdges = cousinBody.edges.filter((e:any)=> e.type==='PARENT_OF' && e.targetId === cId);
    expect(parentEdges.length).toBe(1);
  });

  it('rejects duplicate email on second relation creation', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (p:Person { id:'dupRef1', name:'DupRef', password:'x' })"); } finally { await session.close(); }
    // First parent creation
    const first = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'dupRef1', relationType:'parent', person:{ name:'Parent1', email:'dup@example.com', tempPassword:'password13' } } });
    expect(first.statusCode).toBe(201);
    // Second parent with same email should 409
    const second = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'dupRef1', relationType:'parent', person:{ name:'Parent2', email:'dup@example.com', tempPassword:'password14' } } });
    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body.code).toBe('DUPLICATE');
  });

  // Negative / limit safeguard tests
  it('prevents adding a third parent (LIMIT)', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (c:Person { id:'limitChild', name:'LimitChild', password:'x' })"); } finally { await session.close(); }
    const p1 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'limitChild', relationType:'parent', person:{ name:'ParentL1', email:'limitp1@example.com', tempPassword:'password15' } } });
    expect(p1.statusCode).toBe(201);
    const p2 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'limitChild', relationType:'parent', person:{ name:'ParentL2', email:'limitp2@example.com', tempPassword:'password16' } } });
    expect(p2.statusCode).toBe(201);
    const p3 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'limitChild', relationType:'parent', person:{ name:'ParentL3', email:'limitp3@example.com', tempPassword:'password17' } } });
    expect(p3.statusCode).toBe(400);
    const body = p3.json();
    expect(body.code).toBe('LIMIT');
  });

  it('rejects sibling creation when reference has no parents (MISSING_PARENT)', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (c:Person { id:'sibNoParents', name:'SibNoParents', password:'x' })"); } finally { await session.close(); }
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'sibNoParents', relationType:'sibling', person:{ name:'SiblingX', email:'sibx@example.com', tempPassword:'password18' } } });
    expect(resp.statusCode).toBe(400);
    const body = resp.json();
    expect(body.code).toBe('MISSING_PARENT');
  });

  it('rejects maternal grandparents creation when no female mother present (MISSING_PARENT)', async () => {
    // Create only a male parent
    await seedLinear({ parent:'dadOnly1', child:'refNoMom1', parentGender:'MALE' }, 'paternal');
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refNoMom1', relationType:'maternal_grandparents', person:{ name:'GmaX', email:'gmaX@example.com', tempPassword:'password19' }, options:{ createPair:false } } });
    expect(resp.statusCode).toBe(400);
    const body = resp.json();
    expect(body.code).toBe('MISSING_PARENT');
  });

  it('rejects aunt creation when grandparents missing (MISSING_GRANDPARENT)', async () => {
    await seedLinear({ parent:'momNoGp1', child:'refNoGp1', parentGender:'FEMALE' }, 'maternal'); // mother but no grandparents
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refNoGp1', relationType:'aunt_uncle', person:{ name:'AuntX', email:'auntx@example.com', tempPassword:'password20' }, options:{ side:'maternal' } } });
    expect(resp.statusCode).toBe(400);
    const body = resp.json();
    expect(body.code).toBe('MISSING_GRANDPARENT');
  });

  it('rejects second spouse (LIMIT)', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (p:Person { id:'spLimit1', name:'SpLimit1', password:'x' })"); } finally { await session.close(); }
    const s1 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'spLimit1', relationType:'spouse', person:{ name:'SpouseA', email:'spA@example.com', tempPassword:'password21' } } });
    expect(s1.statusCode).toBe(201);
    const s2 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'spLimit1', relationType:'spouse', person:{ name:'SpouseB', email:'spB@example.com', tempPassword:'password22' } } });
    expect(s2.statusCode).toBe(400);
    const body = s2.json();
    expect(body.code).toBe('LIMIT');
  });

  it('rejects cousin creation with unrelated uncle/aunt id (VALIDATION)', async () => {
    // Seed a simple chain with parent only
    await seedLinear({ parent:'momCFail', child:'refCFail', parentGender:'FEMALE' }, 'maternal');
    const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refCFail', relationType:'cousin', person:{ name:'CousinFail', email:'cousinfail@example.com', tempPassword:'password23' }, options:{ uncleAuntId: 'nonExistentUA' } } });
    expect(resp.statusCode).toBe(400);
    const body = resp.json();
    expect(body.code).toBe('VALIDATION');
  });

  it('enforces parent limit under concurrent parent creations (race)', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (c:Person { id:'raceChild', name:'RaceChild', password:'x' })"); } finally { await session.close(); }
    // First parent to occupy one slot
    const first = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'raceChild', relationType:'parent', person:{ name:'RaceP1', email:'racep1@example.com', tempPassword:'passwordR1' } } });
    expect(first.statusCode).toBe(201);
    // Two concurrent attempts to add remaining parents (only one should succeed)
    const pA = app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'raceChild', relationType:'parent', person:{ name:'RaceP2', email:'racep2@example.com', tempPassword:'passwordR2' } } });
    const pB = app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'raceChild', relationType:'parent', person:{ name:'RaceP3', email:'racep3@example.com', tempPassword:'passwordR3' } } });
    const [rA, rB] = await Promise.all([pA, pB]);
    const statuses = [rA.statusCode, rB.statusCode].sort();
    expect(statuses[0]).toBe(201); // one success
    expect(statuses[1]).toBe(400); // one limited
    const loser = rA.statusCode===400 ? rA : rB;
    expect(loser.json().code).toBe('LIMIT');
  });

  it('returns cached response when same idempotency key is replayed', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (p:Person { id:'idemRef1', name:'IdemRef', password:'x' })"); } finally { await session.close(); }
    const key = 'test-key-123';
    const first = await app.inject({ method:'POST', url:'/relations/add', headers:{ 'idempotency-key': key }, payload:{ referenceId:'idemRef1', relationType:'parent', person:{ name:'IdemParent', email:'idemparent@example.com', tempPassword:'passwordID1' } } });
    expect(first.statusCode).toBe(201);
    const body1 = first.json();
    const second = await app.inject({ method:'POST', url:'/relations/add', headers:{ 'idempotency-key': key }, payload:{ referenceId:'idemRef1', relationType:'parent', person:{ name:'ShouldNotCreate', email:'idemparent@example.com', tempPassword:'passwordID2' } } });
    expect(second.statusCode).toBe(201);
    const body2 = second.json();
    expect(body2).toEqual(body1); // exact cached payload
  });
});
