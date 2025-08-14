import { getDriver, closeDriver } from '../src/lib/neo4j';

(async () => {
  const driver = getDriver();
  const session = driver.session();
  try {
    console.log('Clearing all nodes and relationships...');
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('Done.');
  } catch (e) {
    console.error('Failed to clear database', e);
    process.exitCode = 1;
  } finally {
    await session.close();
    await closeDriver();
  }
})();
