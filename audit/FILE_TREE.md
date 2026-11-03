# Complete tracked file tree at audited revision

47 tracked files. Lockfiles listed but not line-read. No source file excluded.

```text
stockWiseV2/
├── data/
│   ├── .gitkeep
│   └── strategies.json
├── deploy/
│   ├── README.md
│   └── setup.sh
├── scripts/
│   ├── v2/
│   │   ├── .gitkeep
│   │   ├── analyst.mjs
│   │   ├── backtest.mjs
│   │   ├── brain.mjs
│   │   ├── engine.mjs
│   │   ├── engine_ws.mjs
│   │   ├── episode.mjs
│   │   ├── fetch_hist.mjs
│   │   ├── init.mjs
│   │   ├── perp.mjs
│   │   ├── sizing.mjs
│   │   ├── store.mjs
│   │   ├── strategies.mjs
│   │   ├── telegram.mjs
│   │   ├── world.mjs
│   │   └── ws_feed.mjs
│   ├── world/
│   │   ├── .gitkeep
│   │   └── score.mjs
│   ├── .gitkeep
│   ├── daemon.mjs
│   ├── fix_loop.mjs
│   ├── init.mjs
│   └── lib.mjs
├── web/
│   ├── app/
│   │   ├── api/
│   │   │   └── state/
│   │   │       └── route.ts
│   │   ├── components/
│   │   │   ├── DashboardV2.tsx
│   │   │   ├── Root.tsx
│   │   │   └── visuals.tsx
│   │   ├── lib/
│   │   │   └── format.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── public/
│   │   └── avatar.png
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package-lock.json
│   ├── package.json
│   ├── postcss.config.mjs
│   └── tsconfig.json
├── .gitignore
├── README.md
├── config.example.json
├── package-lock.json
└── package.json
```

The .git directory is repository metadata, not application source. This tree describes the fresh checkout before audit outputs were added. No node_modules or build output existed. Full byte hashes, line counts, and review dispositions are in source_inventory.json. Windows checkout core.autocrlf=true changes line endings; both checkout and Git-blob SHA256 values are recorded, and normalized contents match the audited revision.

| File | Lines | Review |
| --- | ---: | --- |
| `.gitignore` | 7 | read in full, line by line |
| `README.md` | 168 | read in full, line by line |
| `config.example.json` | 95 | read in full, line by line |
| `data/.gitkeep` | 1 | read in full, line by line |
| `data/strategies.json` | 291 | read in full, line by line |
| `deploy/README.md` | 100 | read in full, line by line |
| `deploy/setup.sh` | 117 | read in full, line by line |
| `package-lock.json` | binary/skip | skipped: lockfile (authorized) |
| `package.json` | 14 | read in full, line by line |
| `scripts/.gitkeep` | 1 | read in full, line by line |
| `scripts/daemon.mjs` | 510 | read in full, line by line |
| `scripts/fix_loop.mjs` | 126 | read in full, line by line |
| `scripts/init.mjs` | 47 | read in full, line by line |
| `scripts/lib.mjs` | 440 | read in full, line by line |
| `scripts/v2/.gitkeep` | 1 | read in full, line by line |
| `scripts/v2/analyst.mjs` | 216 | read in full, line by line |
| `scripts/v2/backtest.mjs` | 132 | read in full, line by line |
| `scripts/v2/brain.mjs` | 603 | read in full, line by line |
| `scripts/v2/engine.mjs` | 757 | read in full, line by line |
| `scripts/v2/engine_ws.mjs` | 83 | read in full, line by line |
| `scripts/v2/episode.mjs` | 225 | read in full, line by line |
| `scripts/v2/fetch_hist.mjs` | 65 | read in full, line by line |
| `scripts/v2/init.mjs` | 46 | read in full, line by line |
| `scripts/v2/perp.mjs` | 123 | read in full, line by line |
| `scripts/v2/sizing.mjs` | 60 | read in full, line by line |
| `scripts/v2/store.mjs` | 40 | read in full, line by line |
| `scripts/v2/strategies.mjs` | 1027 | read in full, line by line |
| `scripts/v2/telegram.mjs` | 238 | read in full, line by line |
| `scripts/v2/world.mjs` | 359 | read in full, line by line |
| `scripts/v2/ws_feed.mjs` | 60 | read in full, line by line |
| `scripts/world/.gitkeep` | 1 | read in full, line by line |
| `scripts/world/score.mjs` | 172 | read in full, line by line |
| `web/app/api/state/route.ts` | 97 | read in full, line by line |
| `web/app/components/DashboardV2.tsx` | 1117 | read in full, line by line |
| `web/app/components/Root.tsx` | 72 | read in full, line by line |
| `web/app/components/visuals.tsx` | 186 | read in full, line by line |
| `web/app/globals.css` | 90 | read in full, line by line |
| `web/app/layout.tsx` | 39 | read in full, line by line |
| `web/app/lib/format.ts` | 55 | read in full, line by line |
| `web/app/page.tsx` | 5 | read in full, line by line |
| `web/next-env.d.ts` | 6 | read in full, line by line |
| `web/next.config.ts` | 5 | read in full, line by line |
| `web/package-lock.json` | binary/skip | skipped: lockfile (authorized) |
| `web/package.json` | 25 | read in full, line by line |
| `web/postcss.config.mjs` | 8 | read in full, line by line |
| `web/public/avatar.png` | binary/skip | binary asset visually inspected and hashed |
| `web/tsconfig.json` | 41 | read in full, line by line |
