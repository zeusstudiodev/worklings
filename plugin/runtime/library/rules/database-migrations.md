---
title: Database migrations
department: engineering
stacks: [sql, prisma, drizzle, django]
paths:
  - "migrations/**"
  - "**/migrations/**"
  - "prisma/**"
  - "drizzle/**"
  - "db/**"
  - "alembic/**"
  - "supabase/migrations/**"
---
- Change the schema only through migrations made with the project's tool, committed with the code that needs them.
- Never edit a migration that has run anywhere shared; write a new one.
- Read the generated SQL before committing: tools can turn a rename into drop-and-add and lose the data.
- Each migration does one thing and has a name that says what.
- Stay compatible with the code running during a deploy: expand, migrate data, switch code, then contract in a later release.
- Add a required column in steps: nullable or with a default, backfill in batches, then add the NOT NULL constraint.
- Avoid long locks on large tables: build indexes concurrently where the database supports it and batch the backfills.
- Dropping a table or column, or any other destructive change, needs the person's explicit OK and a backup first.
- Keep data migrations separate from schema migrations, and make them idempotent and resumable.
- Have a way back: a down migration or a written rollback plan, tried on a copy.
- Run the migrations from scratch and on a copy with realistic data in tests or CI; the tool's drift check passes.
- Enforce integrity in the database with foreign keys, unique and check constraints, not only in application code.
- Index foreign keys and the columns hot queries filter and sort on; check the query plan for new hot queries.
- Store timestamps in UTC and money as integer minor units or decimals, never floats.
- SQLite and D1 have limited `ALTER TABLE`; check how the tool rebuilds tables before changing column types.
- Seeds and fixtures live apart from migrations and never run in production.
- Production migrations run through the deploy process, never from a laptop unless the person asks.
