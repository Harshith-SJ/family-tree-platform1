import { FastifyInstance } from 'fastify';

interface Bucket { tokens:number; last:number; }
const ipBuckets = new Map<string,Bucket>();
const userBuckets = new Map<string,Bucket>();

function take(map:Map<string,Bucket>, key:string, capacity:number, refillPerSec:number){
  const now = Date.now();
  const b = map.get(key) || { tokens: capacity, last: now };
  const elapsed = (now - b.last)/1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.last = now;
  if(b.tokens < 1) { map.set(key,b); return false; }
  b.tokens -= 1; map.set(key,b); return true;
}

export async function rateLimitPlugin(app: FastifyInstance){
  const IP_CAP = 120; // burst
  const IP_REFILL = 60; // tokens per second
  const USER_CAP = 60;
  const USER_REFILL = 30;
  app.addHook('onRequest', async (req, reply) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    if(!take(ipBuckets, ip, IP_CAP, IP_REFILL)){
      return reply.code(429).send({ message:'Rate limit exceeded (IP)', code:'RATE_LIMIT' });
    }
    if(req.method !== 'GET' && (req as any).user?.sub){
      if(!take(userBuckets, (req as any).user.sub, USER_CAP, USER_REFILL)){
        return reply.code(429).send({ message:'Rate limit exceeded (user)', code:'RATE_LIMIT' });
      }
    }
  });
}
