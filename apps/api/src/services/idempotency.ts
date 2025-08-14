import { getDriver } from '../lib/neo4j';

export async function getIdem(userId:string, key:string){
  const driver = getDriver();
  const session = driver.session();
  try {
    const res = await session.run(`MATCH (i:Idem { key:$key, userId:$userId }) WHERE i.expiresAt > datetime() RETURN i LIMIT 1`, { key:`${userId}:${key}`, userId });
    if(res.records.length===0) return null;
    const node = res.records[0].get('i').properties;
    return { status: node.status.toNumber ? node.status.toNumber() : node.status, payload: JSON.parse(node.payload) };
  } finally { await session.close(); }
}

export async function putIdem(userId:string, key:string, status:number, payload:any, ttlSeconds=600){
  const driver = getDriver();
  const session = driver.session();
  try {
    await session.run(`MERGE (i:Idem { key:$k, userId:$userId })
      ON CREATE SET i.status=$status, i.payload=$payload, i.route=$route, i.createdAt=datetime(), i.expiresAt=datetime() + duration({ seconds:$ttl }), i.ttlSeconds=$ttl
      RETURN i`, { k:`${userId}:${key}`, userId, status, payload: JSON.stringify(payload), route:'/relations/add', ttl: ttlSeconds });
  } finally { await session.close(); }
}
