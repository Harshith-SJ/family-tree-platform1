import { Driver } from 'neo4j-driver';

export interface PersonInput { name:string; email:string|null; gender?:string|null; birthDate?:string|null; password?:string|null; }

export async function createPerson(tx: any, data: PersonInput){
  const res = await tx.run(`CREATE (p:Person { id: randomUUID(), name:$name, email:$email, gender:$gender, birthDate:$birthDate, password:$password, createdAt: datetime() }) RETURN p`, data);
  return res.records[0]?.get('p').properties;
}

export async function attachToFamily(tx:any, personId:string, familyId:string){
  await tx.run(`MATCH (p:Person { id:$pid }), (f:Family { id:$fid }) MERGE (p)-[:MEMBER_OF]->(f)`, { pid: personId, fid: familyId });
}
