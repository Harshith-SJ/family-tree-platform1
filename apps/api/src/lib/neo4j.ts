import neo4j, { Driver } from 'neo4j-driver';
import { env } from '../config/env';

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
      { /* encrypted by default for neo4j+s */ }
    );
  }
  return driver;
}

export async function getSession(database?: string) {
  const d = getDriver();
  return d.session({ defaultAccessMode: neo4j.session.WRITE, database });
}

export async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
