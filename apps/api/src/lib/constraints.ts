import { getDriver } from './neo4j';

export async function ensureConstraints(){
  const driver = getDriver();
  const session = driver.session();
  try {
    await session.run(`CREATE CONSTRAINT idem_key IF NOT EXISTS FOR (i:Idem) REQUIRE i.key IS UNIQUE`);
  } finally { await session.close(); }
}
