# Built live by Ambient Builder

This app is built while people talk about the idea. Rules for the coding agent:

- Single-page Vite + React (JSX) + Tailwind v4 app. No backend: mock data lives in `src/data/` and persists in localStorage.
- Keep `vite.config.js`'s `base` and `server` settings unchanged (the live preview depends on them).
- Build only what SPEC.md lists as decided. Roadmap items get at most a small "Coming soon" stub.
- Keep the app runnable after every change: `npm run build` must pass.
- Prefer a few clear components in `src/components/` over one giant file. Mobile-first layout.
