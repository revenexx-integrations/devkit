---
"@revenexx/integrations-node-devkit": patch
---

`npm run preview` starts again without extra switches. The preview host asked for `@solar-icons/nuxt` `^2.3.2`, while `@revenexx/studio-shared` accepts only `^1.2.0` as a peer, so the host's `npm install` stopped with `ERESOLVE` on every start. The host now uses `^1.2.0`, the version the Cockpit and the studio packages run on, and `npm_config_legacy_peer_deps=true` is no longer needed.
