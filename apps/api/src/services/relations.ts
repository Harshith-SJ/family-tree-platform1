import bcrypt from 'bcryptjs';
import { AddRelationInput } from '../schemas/relations';
import { AppError } from '../errors/AppError';
import { env } from '../config/env';
import { validatePassword } from '../lib/password';

// Simple timing helper for optional structured logging (could be replaced by pino child logger)
function nowMs(){ return Date.now(); }
function diffMs(start:number){ return Date.now()-start; }

// Core write operation encapsulated for unit testing and reuse
export async function addRelationWrite(tx:any, body: AddRelationInput, userId: string) {
  const t0 = nowMs();
  const needsPerson = ['parent','child','spouse','sibling','maternal_grandparents','paternal_grandparents','aunt_uncle','cousin'].includes(body.relationType);
  if (needsPerson && !body.person) throw new AppError('person object required',400,'VALIDATION');

  const createPersonFragment = (alias:string, nameVar='$name', emailVar='$email', genderVar='$gender') => `(${alias}:Person { id: randomUUID(), name:${nameVar}, email:${emailVar}, gender:${genderVar}, birthDate:$birthDate, password:$password, createdAt: datetime(), createdBy: $userId })`;

  // Ensure reference person exists (and implicitly that it can anchor family membership lookups later)
  const refRes = await tx.run(`MATCH (r:Person { id: $rid }) RETURN r LIMIT 1`, { rid: body.referenceId });
  if (refRes.records.length === 0) throw new AppError('Reference person not found',404,'NOT_FOUND');

  const rounds = isNaN(env.BCRYPT_ROUNDS) ? 10 : env.BCRYPT_ROUNDS;
  if (body.person?.tempPassword) {
    const err = validatePassword(body.person.tempPassword);
    if (err) throw new AppError(err,400,'WEAK_PASSWORD');
  }
  if (body.partner?.tempPassword) {
    const err = validatePassword(body.partner.tempPassword);
    if (err) throw new AppError(err,400,'WEAK_PASSWORD');
  }
  const hashed = body.person ? await bcrypt.hash(body.person.tempPassword, rounds) : '';
  const params: Record<string, any> = {
    rid: body.referenceId,
    name: body.person?.name,
    email: body.person?.email,
    gender: body.person?.gender ?? null,
    birthDate: body.person?.birthDate ?? null,
    password: hashed,
    userId
  };
  // Prevent duplicate person creation by email (simple existence check before attempting write)
  if (body.person?.email && body.relationType !== 'aunt_uncle') {
    const dupCheck = await tx.run(`MATCH (p:Person { email: $email }) RETURN p LIMIT 1`, { email: body.person.email });
    if (dupCheck.records.length > 0) {
      throw new AppError('Email already exists for another person', 409, 'DUPLICATE');
    }
  }
  if (body.partner?.email) {
    const dupCheck2 = await tx.run(`MATCH (p:Person { email: $pemail }) RETURN p LIMIT 1`, { pemail: body.partner.email });
    if (dupCheck2.records.length > 0) {
      throw new AppError('Partner email already exists for another person', 409, 'DUPLICATE');
    }
  }
  let cypher = '';

  switch (body.relationType) {
    case 'parent': {
      // Enforce parent limit under concurrency by locking reference node via a counting pattern.
      // We use a deterministic MERGE on a generated uuid inside a subquery to avoid duplicate creation when two writes race.
      cypher = `MATCH (ref:Person { id:$rid })
CALL {
  WITH ref
  OPTIONAL MATCH (ref)<-[:PARENT_OF]-(:Person)
  WITH ref, count(*) AS curCount
  WHERE curCount < 2
  CREATE ${createPersonFragment('p')}
  CREATE (p)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(ref)
  RETURN p
}
WITH ref, p
OPTIONAL MATCH (ref)<-[:PARENT_OF]-(:Person)
WITH p, count(*) AS afterCount
WHERE afterCount <= 2
RETURN [p] as createdNodes`;
      break; }
    case 'child': {
  cypher = `MATCH (ref:Person { id: $rid })
OPTIONAL MATCH (ref)-[:SPOUSE_OF]->(sp:Person)
CREATE ${createPersonFragment('c')}
CREATE (ref)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(c)
FOREACH(_ IN CASE WHEN sp IS NOT NULL THEN [1] ELSE [] END | CREATE (sp)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(c))
RETURN [c] as createdNodes`;
      break; }
    case 'spouse': {
  // Property-based optimistic lock: only first creation when _spouseLock is null succeeds.
  cypher = `MATCH (ref:Person { id:$rid })
// Acquire lock by doing a write on ref; second tx waits until first commits
SET ref._spouseLock = coalesce(ref._spouseLock, randomUUID())
WITH ref
OPTIONAL MATCH (ref)-[:SPOUSE_OF]->(existing:Person)
WITH ref, existing
WHERE existing IS NULL
CREATE ${createPersonFragment('s')}
MERGE (ref)-[r1:SPOUSE_OF]->(s)
ON CREATE SET r1.createdAt=datetime(), r1.createdBy=$userId
MERGE (s)-[r2:SPOUSE_OF]->(ref)
ON CREATE SET r2.createdAt=datetime(), r2.createdBy=$userId
RETURN [s] as createdNodes`;
      break; }
    case 'sibling': {
  const parentsRes = await tx.run(`MATCH (p:Person)-[:PARENT_OF]->(r:Person { id:$rid }) RETURN p.id as id`, { rid: body.referenceId });
  if (parentsRes.records.length === 0) throw new AppError('Reference has no parents; add a parent first',400,'MISSING_PARENT');
  cypher = `MATCH (ref:Person { id:$rid })<-[:PARENT_OF]-(p:Person)
WITH collect(p) as parents
CREATE ${createPersonFragment('s')}
WITH parents, s
FOREACH(parent IN parents | MERGE (parent)-[rel:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(s))
RETURN [s] as createdNodes`;
  break; }
    case 'maternal_grandparents':
    case 'paternal_grandparents': {
      const isMaternal = body.relationType === 'maternal_grandparents';
      const parentGender = isMaternal ? 'FEMALE' : 'MALE';
      const parentAlias = isMaternal ? 'mom' : 'dad';
      const parentMissingMsg = isMaternal ? 'Mother missing (need a mother with gender=FEMALE)' : 'Father missing (need a father with gender=MALE)';
      const parentRes = await tx.run(`MATCH (c:Person { id:$rid })<-[:PARENT_OF]-(${parentAlias}:Person) WHERE ${parentAlias}.gender='${parentGender}' RETURN ${parentAlias}.id as id`, { rid: body.referenceId });
      if (parentRes.records.length === 0) throw new AppError(parentMissingMsg,400,'MISSING_PARENT');
      const parentId = parentRes.records[0].get('id');
      const existingRes = await tx.run(`MATCH (gp:Person)-[:PARENT_OF]->(${parentAlias}:Person { id:$pid }) RETURN gp.id as id`, { pid: parentId });
      const existing = existingRes.records.map((r:any)=>r.get('id'));
      const createPair = !!body.options?.createPair;
      if (!body.person) throw new AppError('person required',400,'VALIDATION');
      if (existing.length >=2) throw new AppError(`${isMaternal?'Mother':'Father'} already has two parents`,400,'LIMIT');
      if (existing.length===1 && createPair && body.partner) throw new AppError('Only one new grandparent allowed; existing grandparent present. Do not supply partner.',400,'LIMIT');
      if (createPair && existing.length===0) {
        if (!body.partner) throw new AppError('partner required when createPair true and no existing grandparents',400,'VALIDATION');
    const hashed2 = await bcrypt.hash(body.partner.tempPassword, rounds);
        params.partnerName = body.partner.name;
        params.partnerEmail = body.partner.email;
        params.partnerGender = body.partner.gender ?? null;
        params.partnerBirthDate = body.partner.birthDate ?? null;
        params.partnerPassword = hashed2;
  cypher = `MATCH (c:Person { id:$rid })<-[:PARENT_OF]-(${parentAlias}:Person { id:$pid })
CREATE ${createPersonFragment('gp1')}
CREATE (gp2:Person { id: randomUUID(), name:$partnerName, email:$partnerEmail, gender:$partnerGender, birthDate:$partnerBirthDate, password:$partnerPassword, createdAt: datetime(), createdBy: $userId })
CREATE (gp1)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(${parentAlias})
CREATE (gp2)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(${parentAlias})
MERGE (gp1)-[r1:SPOUSE_OF]->(gp2)
ON CREATE SET r1.createdAt=datetime(), r1.createdBy=$userId
MERGE (gp2)-[r2:SPOUSE_OF]->(gp1)
ON CREATE SET r2.createdAt=datetime(), r2.createdBy=$userId
RETURN gp1, gp2`;
      } else if (existing.length===1) {
  cypher = `MATCH (c:Person { id:$rid })<-[:PARENT_OF]-(${parentAlias}:Person { id:$pid })
MATCH (existing:Person)-[:PARENT_OF]->(${parentAlias})
WHERE existing.id IN $existingIds
CREATE ${createPersonFragment('gp')}
CREATE (gp)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(${parentAlias})
MERGE (gp)-[r1:SPOUSE_OF]->(existing)
ON CREATE SET r1.createdAt=datetime(), r1.createdBy=$userId
MERGE (existing)-[r2:SPOUSE_OF]->(gp)
ON CREATE SET r2.createdAt=datetime(), r2.createdBy=$userId
RETURN gp`;
        params.existingIds = existing;
      } else {
  cypher = `MATCH (c:Person { id:$rid })<-[:PARENT_OF]-(${parentAlias}:Person { id:$pid })
CREATE ${createPersonFragment('gp')}
CREATE (gp)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(${parentAlias})
RETURN gp`;
      }
      if (isMaternal) params.momId = parentId; else params.dadId = parentId; // backward compat
      params.pid = parentId;
      break; }
    case 'aunt_uncle': {
      const side = body.options?.side;
      if (side !== 'maternal' && side !== 'paternal') throw new AppError('options.side required (maternal/paternal)',400,'VALIDATION');
      const q = side === 'maternal'
        ? `MATCH (mom:Person)-[:PARENT_OF]->(ref:Person { id:$rid }) WHERE mom.gender='FEMALE' RETURN mom LIMIT 1`
        : `MATCH (dad:Person)-[:PARENT_OF]->(ref:Person { id:$rid }) WHERE dad.gender='MALE' RETURN dad LIMIT 1`;
      const check = await tx.run(q, { rid: body.referenceId });
      if (check.records.length === 0) throw new AppError(`${side} parent missing`,400,'MISSING_PARENT');
      const grandQ = side === 'maternal'
        ? `MATCH (gp:Person)-[:PARENT_OF]->(mom:Person)-[:PARENT_OF]->(ref:Person { id:$rid }) WHERE mom.gender='FEMALE' RETURN gp LIMIT 1`
        : `MATCH (gp:Person)-[:PARENT_OF]->(dad:Person)-[:PARENT_OF]->(ref:Person { id:$rid }) WHERE dad.gender='MALE' RETURN gp LIMIT 1`;
      const gpCheck = await tx.run(grandQ, { rid: body.referenceId });
      if (gpCheck.records.length === 0) throw new AppError('Grandparent missing; create grandparents first',400,'MISSING_GRANDPARENT');
      cypher = side === 'maternal'
  ? `MATCH (gp:Person)-[:PARENT_OF]->(mom:Person)-[:PARENT_OF]->(ref:Person { id:$rid }) WHERE mom.gender='FEMALE'
MERGE (au:Person { email:$email })
ON CREATE SET au.id = randomUUID(), au.name = $name, au.gender = $gender, au.birthDate = $birthDate, au.password = $password, au.createdAt = datetime(), au.createdBy = $userId
MERGE (gp)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(au)
RETURN [au] as createdNodes`
  : `MATCH (gp:Person)-[:PARENT_OF]->(dad:Person)-[:PARENT_OF]->(ref:Person { id:$rid }) WHERE dad.gender='MALE'
MERGE (au:Person { email:$email })
ON CREATE SET au.id = randomUUID(), au.name = $name, au.gender = $gender, au.birthDate = $birthDate, au.password = $password, au.createdAt = datetime(), au.createdBy = $userId
MERGE (gp)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(au)
RETURN [au] as createdNodes`;
      break; }
    case 'cousin': {
      const uaId = body.options?.uncleAuntId;
      if (!uaId) throw new AppError('options.uncleAuntId required',400,'VALIDATION');
      const relCheck = await tx.run(`MATCH (ref:Person { id:$rid })<-[:PARENT_OF]-(parent:Person)<-[:PARENT_OF]-(gp:Person)-[:PARENT_OF]->(ua:Person { id:$uaId }) RETURN ua LIMIT 1`, { rid: body.referenceId, uaId });
      if (relCheck.records.length === 0) throw new AppError('Provided uncle/aunt not related to reference',400,'VALIDATION');
  cypher = `MATCH (ua:Person { id:$uaId })
OPTIONAL MATCH (ua)-[:SPOUSE_OF]->(sp:Person)
CREATE ${createPersonFragment('c')}
CREATE (ua)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(c)
FOREACH(_ IN CASE WHEN sp IS NOT NULL THEN [1] ELSE [] END | CREATE (sp)-[:PARENT_OF { createdAt: datetime(), createdBy: $userId }]->(c))
RETURN [c] as createdNodes`;
      params.uaId = uaId; break; }
    default:
      throw new AppError('Unsupported relationType',400,'VALIDATION');
  }

  const createRes = await tx.run(cypher, params);
  const firstRecord = createRes.records[0];
  if(!firstRecord){
    if(body.relationType==='parent') throw new AppError('Reference already has two parents',400,'LIMIT');
    if(body.relationType==='spouse') throw new AppError('Reference already has a spouse',400,'LIMIT');
    if(body.relationType==='cousin') throw new AppError('Cousin creation path resolution failed',400,'VALIDATION');
    throw new AppError('Creation failed',500,'INTERNAL');
  }
  const createdNodeProps:any[] = [];
  // Prefer explicit createdNodes key if present
  if(firstRecord.keys.includes('createdNodes')) {
    const arr:any = firstRecord.get('createdNodes');
    if(Array.isArray(arr)) arr.forEach((v:any)=>{ if(v?.properties) createdNodeProps.push(v.properties); });
  } else {
    firstRecord.keys.forEach((k:any)=>{
      const val:any = firstRecord.get(k as any);
      if(Array.isArray(val)) val.forEach((v:any)=>{ if(v?.properties) createdNodeProps.push(v.properties); });
      else if (val?.properties) createdNodeProps.push(val.properties);
    });
  }
  // Post-create spouse concurrency guard: if spouse just created ensure only one spouse total
  if(body.relationType==='spouse') {
    const spouseCntRes = await tx.run(`MATCH (:Person { id:$rid })-[:SPOUSE_OF]->(s:Person) RETURN count(s) as cnt`, { rid: body.referenceId });
    const cnt = spouseCntRes.records[0]?.get('cnt')?.toNumber?.() ?? 0;
    if(cnt > 1) {
      throw new AppError('Reference already has a spouse',400,'LIMIT');
    }
  }
  if(createdNodeProps.length===0) throw new AppError('No nodes created',500,'INTERNAL');
  const createdIds = createdNodeProps.map(n=>n.id);
  const edgeQuery = `MATCH (p:Person) WHERE p.id IN $nids
    OPTIONAL MATCH (p)-[:PARENT_OF]->(child:Person)
    OPTIONAL MATCH (parent:Person)-[:PARENT_OF]->(p)
    OPTIONAL MATCH (p)-[:SPOUSE_OF]->(sp:Person)
    RETURN collect(DISTINCT { type:'PARENT_OF', sourceId:p.id, targetId:child.id }) as down,
           collect(DISTINCT { type:'PARENT_OF', sourceId:parent.id, targetId:p.id }) as up,
           collect(DISTINCT { type:'SPOUSE_OF', sourceId:p.id, targetId:sp.id }) as spouse`;
  const edgeRes = await tx.run(edgeQuery, { nids: createdIds });
  const rec = edgeRes.records[0];
  const edgesRaw = [
    ...rec.get('down').filter((e:any)=>e.targetId),
    ...rec.get('up').filter((e:any)=>e.sourceId),
    ...rec.get('spouse').filter((e:any)=>e.targetId)
  ];
  const spouseDup = edgesRaw.filter(e=>e.type==='SPOUSE_OF').map(e=>({ type:'SPOUSE_OF', sourceId:e.targetId, targetId:e.sourceId }));
  const edges = [...edgesRaw, ...spouseDup];
  // Attach all newly created nodes to the reference person's family (room scoping + tree visibility)
  // (We deliberately do this in a separate query to avoid rewriting each relation-specific creation Cypher.)
  const famRes = await tx.run(`MATCH (ref:Person { id:$rid })-[:MEMBER_OF]->(f:Family)
    WITH f
    UNWIND $nids as nid
    MATCH (p:Person { id:nid })
    MERGE (p)-[m:MEMBER_OF]->(f)
    ON CREATE SET m.role='MEMBER'
    RETURN f.id as fid`, { rid: body.referenceId, nids: createdIds });
  const familyId = famRes.records[0]?.get('fid') || null; // could be null if reference not yet in a family
  const result = { familyId, nodes: createdNodeProps, edges };
  if (process.env.RELATION_LOG === '1') {
    // Minimal structured log to stdout
    console.log(JSON.stringify({ evt:'relation_created', relationType: body.relationType, referenceId: body.referenceId, createdIds, ms: diffMs(t0) }));
  }
  return result;
}
// End addRelationWrite

