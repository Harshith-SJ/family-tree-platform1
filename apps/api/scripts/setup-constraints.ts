import { getDriver, closeDriver } from '../src/lib/neo4j';

async function main(){
  const driver = getDriver();
  const session = driver.session();
  try {
    const statements = [
      'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT person_email IF NOT EXISTS FOR (p:Person) REQUIRE p.email IS UNIQUE',
      'CREATE CONSTRAINT family_id IF NOT EXISTS FOR (f:Family) REQUIRE f.id IS UNIQUE',
      'CREATE CONSTRAINT message_id IF NOT EXISTS FOR (m:Message) REQUIRE m.id IS UNIQUE'
    ];
    for(const cy of statements){
      await session.run(cy);
    }
    console.log('Constraints ensured');
  } finally {
    await session.close();
    await closeDriver();
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
