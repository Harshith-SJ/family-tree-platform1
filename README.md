# Family Tree Platform — Monorepo

This is the hackathon build. Start with the API, then wire the web app.

## Structure (in-progress)
- apps/api — Fastify API with Neo4j AuraDB
- apps/web — Next.js web app
- packages/shared — shared types

## Getting Started (API)
1. Copy `.env.example` to `.env` and fill real secrets.
2. Install deps and run dev.

```bash
cd apps/api
npm install
npm run dev
```

The API reads Neo4j AuraDB creds and starts on :4001.

## Getting Started (Web)
1. In another terminal:
1. Install deps and run dev.

```bash
cd apps/web
npm install
npm run dev
```

Visit http://localhost:3000 and sign up. Ensure NEXT_PUBLIC_API_URL points to http://localhost:4001.

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000. After signup/login, go to Families, create/open a family, then use the Tree at /families/{id}/tree and Chat at /families/{id}/chat.
