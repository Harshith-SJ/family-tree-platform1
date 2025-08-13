# Hackathon Requirements, Plan, and Tracking

This file tracks requirements, plan, and status for the Family Tree Platform hackathon build.

## Requirements
- Multi-family support: Each family has its own tree, members, and chat
- Real-time collaboration: Socket.IO-based updates (nodes, edges, chat)
- Graph DB: Neo4j AuraDB via Prisma or Neo4j driver
- Auth: JWT (no localStorage), store in httpOnly cookies; clean session handling
- Forms: 4-step signup with Zod + React Hook Form
- Visualization: React Flow with draggable nodes and labeled edges
- Manual Node Controls: Fine-tune X/Y; persist per-family
- Export: PNG export of current tree view
- UI: Tailwind + shadcn/ui; responsive and accessible
- Testing: Vitest + Supertest minimal coverage
- DevOps: Turborepo, env-managed secrets, Git commits for each milestone

## Non-Goals (for hackathon scope)
- Granular role/permission system beyond basic member/admin
- Complex offline sync
- PDF export (stretch)

## Milestones and Checklist

### M0 — Repo and Config
- [ ] Turborepo scaffolded (apps/web, apps/api, packages/shared)
- [ ] Git initialized, initial commit
- [ ] .gitignore committed
- [ ] .env.example committed with Neo4j/JWT keys (no real secrets)

### M1 — Backend API skeleton
- [ ] Fastify + Zod boot server
- [ ] Health route `/health`
- [ ] Neo4j connection util
- [ ] JWT util (sign/verify) using env secret
- [ ] Auth routes: `/auth/signup`, `/auth/login`, `/auth/me`

### M2 — Data model and tree routes
- [ ] Person, Family, Message models (Prisma or direct Neo4j CYPHER)
- [ ] CRUD: `/families`, `/families/:id/nodes`, `/families/:id/edges`
- [ ] Persist node positions per family

### M3 — Realtime + Chat
- [ ] Socket.IO server + namespaces per family
- [ ] Events: node:move, node:lock, edge:update, chat:send
- [ ] Basic node locking

### M4 — Frontend app
- [ ] Next.js app with Tailwind + shadcn
- [ ] Signup/Login pages
- [ ] Family Tree page with React Flow
- [ ] Manual position controls (inputs)
- [ ] Chat UI
- [ ] Export as PNG

### M5 — QA + Deploy
- [ ] Basic tests run
- [ ] Vercel + Railway deploy configs
- [ ] README with run instructions

## Risks & Mitigations
- Neo4j schema/time: Use direct cypher first, Prisma optional
- Auth complexity: Keep JWT simple with cookies, rotate later
- WebSocket scaling: Single instance for demo

## Tracking
Use git commits per milestone with messages like: `feat(api): add auth routes`.
