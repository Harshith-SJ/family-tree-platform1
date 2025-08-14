import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { errorHandlingPlugin } from '../src/plugins/errorHandler';
import { getDriver, closeDriver } from '../src/lib/neo4j';

let app: any;

// Local helpers (duplicated from main integration file to keep tests isolated)
async function runCypher(statements: string[]) {
  const session = getDriver().session();
  try { for (const s of statements) { await session.run(s); } } finally { await session.close(); }
}

async function seedLinear(ids: { gp?: string; parent?: string; child: string; parentGender?: 'MALE'|'FEMALE' }, side: 'maternal'|'paternal') {
  const { gp, parent, child, parentGender } = ids;
  const gender = parentGender || (side === 'maternal' ? 'FEMALE' : 'MALE');
  const chain: string[] = [];
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

describe.sequential('integration: extended relations scenarios', () => {
  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlingPlugin);
    const { registerRelationRoutes } = await import('../src/routes/relations');
    await app.register(async function(fakeAuth){
      fakeAuth.addHook('preHandler', (req:any,_res,done)=>{ req.user={ sub:'test', email:'t@example.com'}; done(); });
      await registerRelationRoutes(fakeAuth as any);
    });
    await app.ready();
  // Ensure email uniqueness constraint for race-condition tests
  try { await runCypher(["CREATE CONSTRAINT person_email_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.email IS UNIQUE"]); } catch {}
  });
  afterAll(async () => { await app.close(); await closeDriver(); });
  beforeEach(async () => { await clearDb(); });

  it('creates single maternal grandparent when createPair false', async () => {
    await seedLinear({ parent:'momSolo', child:'refMG1', parentGender:'FEMALE' }, 'maternal');
  const resp = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refMG1', relationType:'maternal_grandparents', person:{ name:'GmaSolo', email:'gmasolo@example.com', tempPassword:'PasswordA1' }, options:{ createPair:false } } });
    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    expect(body.nodes.length).toBe(1);
  });

  it('adds second paternal grandparent when one exists and returns spouse edges', async () => {
    await seedLinear({ parent:'dadSingle', child:'refPGSingle', parentGender:'MALE' }, 'paternal');
    // First grandparent (single)
  const first = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refPGSingle', relationType:'paternal_grandparents', person:{ name:'GpaOnly', email:'gpaonly@example.com', tempPassword:'PasswordB1' }, options:{ createPair:false } } });
    expect(first.statusCode).toBe(201);
    // Second grandparent should create spouse edges to existing
  const second = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refPGSingle', relationType:'paternal_grandparents', person:{ name:'GmaSecond', email:'gmasecond@example.com', tempPassword:'PasswordC1' }, options:{ createPair:false } } });
    expect(second.statusCode).toBe(201);
    const body2 = second.json();
    const spouseEdges = body2.edges.filter((e:any)=> e.type==='SPOUSE_OF');
    expect(spouseEdges.length).toBeGreaterThanOrEqual(2); // bidirectional
    const dirSet = new Set(spouseEdges.map((e:any)=> e.sourceId+'=>'+e.targetId));
    expect(dirSet.size).toBeGreaterThanOrEqual(2);
  });

  it("creates cousin with aunt's spouse also linked as parent (two parent edges)", async () => {
    // Need maternal grandparents for aunt
    await seedLinear({ parent:'momForAunt', child:'refCousinSp', parentGender:'FEMALE' }, 'maternal');
    // Create maternal grandparents pair first
  const gpPair = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refCousinSp', relationType:'maternal_grandparents', person:{ name:'GmaPair', email:'gmapair@example.com', tempPassword:'PasswordD1' }, partner:{ name:'GpaPair', email:'gpapair@example.com', tempPassword:'PasswordE1' }, options:{ createPair:true } } });
    expect(gpPair.statusCode).toBe(201);
    // Create aunt
  const aunt = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refCousinSp', relationType:'aunt_uncle', person:{ name:'AuntSp', email:'auntsp@example.com', tempPassword:'PasswordF1' }, options:{ side:'maternal' } } });
    expect(aunt.statusCode).toBe(201);
    const auntBody = aunt.json();
    const auntId = auntBody.nodes[0].id;
    // Add spouse for aunt
  const auntSpouse = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId: auntId, relationType:'spouse', person:{ name:'AuntSpouse', email:'auntspouse@example.com', tempPassword:'PasswordG1' } } });
    expect(auntSpouse.statusCode).toBe(201);
    // Create cousin referencing aunt id; service should attach spouse too
  const cousin = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'refCousinSp', relationType:'cousin', person:{ name:'CousinSp', email:'cousinsp@example.com', tempPassword:'PasswordH1' }, options:{ uncleAuntId: auntId } } });
    expect(cousin.statusCode).toBe(201);
    const cBody = cousin.json();
    const newId = cBody.nodes[0].id;
    const parentEdges = cBody.edges.filter((e:any)=> e.type==='PARENT_OF' && e.targetId===newId);
    expect(parentEdges.length).toBe(2); // aunt + spouse
  });

  it('returns cached 201 for idempotent parent creation even after limit would now apply', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (c:Person { id:'idemEdgeChild', name:'IdemEdgeChild', password:'x' })"); } finally { await session.close(); }
    const key = 'idem-edge-key';
  const first = await app.inject({ method:'POST', url:'/relations/add', headers:{ 'idempotency-key': key }, payload:{ referenceId:'idemEdgeChild', relationType:'parent', person:{ name:'IdemEdgeP1', email:'idemedgep1@example.com', tempPassword:'PasswordI1' } } });
    expect(first.statusCode).toBe(201);
    const body1 = first.json();
    // Add second parent (fills limit)
  const secondParent = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'idemEdgeChild', relationType:'parent', person:{ name:'IdemEdgeP2', email:'idemedgep2@example.com', tempPassword:'PasswordJ1' } } });
    expect(secondParent.statusCode).toBe(201);
    // Replay original idempotency key (should return cached 201, not LIMIT 400)
    const replay = await app.inject({ method:'POST', url:'/relations/add', headers:{ 'idempotency-key': key }, payload:{ referenceId:'idemEdgeChild', relationType:'parent', person:{ name:'SHOULD_IGNORE', email:'idemedgep1@example.com', tempPassword:'different' } } });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(body1);
  });

  it('creates sibling with two existing parents and returns both parent edges', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (c:Person { id:'sibRef2', name:'SibRef2', password:'x' })"); } finally { await session.close(); }
    const p1 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'sibRef2', relationType:'parent', person:{ name:'SibRef2P1', email:'sibref2p1@example.com', tempPassword:'PasswordK1' } } });
    expect(p1.statusCode).toBe(201);
    const p2 = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'sibRef2', relationType:'parent', person:{ name:'SibRef2P2', email:'sibref2p2@example.com', tempPassword:'PasswordL1' } } });
    expect(p2.statusCode).toBe(201);
  const sib = await app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'sibRef2', relationType:'sibling', person:{ name:'Sib2New', email:'sib2new@example.com', tempPassword:'PasswordM1' } } });
    expect(sib.statusCode).toBe(201);
    const body = sib.json();
    const newId = body.nodes[0].id;
    const parentEdges = body.edges.filter((e:any)=> e.type==='PARENT_OF' && e.targetId===newId);
    expect(parentEdges.length).toBe(2);
  });

  it('concurrent duplicate email parent attempts -> one success, one DUPLICATE', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (c:Person { id:'dupConcChild', name:'DupConc', password:'x' })"); } finally { await session.close(); }
  const pA = app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'dupConcChild', relationType:'parent', person:{ name:'DupParentA', email:'dupconc@example.com', tempPassword:'PasswordN1' } } });
  const pB = app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'dupConcChild', relationType:'parent', person:{ name:'DupParentB', email:'dupconc@example.com', tempPassword:'PasswordO1' } } });
    const [rA, rB] = await Promise.all([pA, pB]);
    const statuses = [rA.statusCode, rB.statusCode].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);
    const loser = rA.statusCode===409 ? rA : rB;
    expect(loser.json().code).toBe('DUPLICATE');
  });

  it('concurrent spouse creation -> only one succeeds', async () => {
    const session = getDriver().session();
    try { await session.run("CREATE (p:Person { id:'spouseRaceRef', name:'SpouseRaceRef', password:'x' })"); } finally { await session.close(); }
  const sA = app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'spouseRaceRef', relationType:'spouse', person:{ name:'SpouseRaceA', email:'spouseracea@example.com', tempPassword:'PasswordP1' } } });
  const sB = app.inject({ method:'POST', url:'/relations/add', payload:{ referenceId:'spouseRaceRef', relationType:'spouse', person:{ name:'SpouseRaceB', email:'spouseraceb@example.com', tempPassword:'PasswordQ1' } } });
    const [rA, rB] = await Promise.all([sA, sB]);
    const statuses = [rA.statusCode, rB.statusCode].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(400); // LIMIT
    const loser = rA.statusCode===400 ? rA : rB;
    expect(loser.json().code).toBe('LIMIT');
  });
});
