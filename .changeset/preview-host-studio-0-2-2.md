---
'@revenexx/integrations-node-devkit': patch
---

The preview host pins `@revenexx/studio` ^0.2.2, so its dependencies install again

Moving the host to `@revenexx/studio-shared` ^0.3.0 left `@revenexx/studio` at `^0.1.3`,
and 0.3.x peers `@revenexx/studio` `^0.2.0`. Because a caret on a 0.x version pins the
minor, `^0.1.3` can never reach 0.2.x — so the two pins were unsatisfiable together and
`npm install` in the copied host failed outright with `ERESOLVE`, before Nuxt ever booted.
The devkit runs a plain `npm install` with no `--legacy-peer-deps`, so nothing papered over
it: every fresh preview was broken, not merely resolving oddly.

0.2.2 is the current release. Its only new peer, `vue-sonner` `^2.0.9`, is already
satisfied by the host's `^2.0.0` pin.

`@solar-icons/nuxt` stays on ^1.2.1 deliberately. Dependabot groups it with studio and
offers ^2.1.0, but `@revenexx/studio-shared` 0.3.x peers `@solar-icons/nuxt` `^1.2.0` in
both of its releases, so the major would trade this conflict for the same one one package
over — and v2 reworks the module options and the auto-import names the studio components
rely on. It waits until studio-shared moves.
