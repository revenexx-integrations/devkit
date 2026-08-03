# integrations-node-devkit

`@revenexx/integrations-node-devkit` is the local development kit for Revenexx
integration node packages. It lets a node developer see and test their work without
running the full Docker stack.

It gives you two things:

1. **A mock Integrations API with a Cockpit preview.** The preview renders the
   credentials, nodes and templates you are building using the *real* production UI
   components — including live config-field resolving.
2. **A unit-testing harness** for node `execute`, author-time resolvers, and credential
   `test` / `resolve` / OAuth flows.

The mock invokes your package's real `loadOptions`, `resolveConfigSchema`,
`resolveOutputs`, `test` and `resolve` **in-process** — no bundle, no sandbox. What you
see is your actual source, reloaded on save.

!!! warning "Dev/CI only"
    This is a `devDependency` and is **never** part of a built node bundle. It ships no
    production code path.

## Where it fits

The devkit sits between the node packages and the Integration Studio UI:

- It consumes the contracts from **`integrations-node-sdk`** (`INode`,
  `INodeDescription`, `INodeContext`, …) to load and introspect your package.
- Its preview host mounts **`@revenexx/studio-integrations`**, the Nuxt module that *is*
  the Cockpit UI, and points it at the mock API instead of the Laravel service.

Node packages such as `core`, `pipedrive` and `business-central` are its intended
consumers.

## Where to go next

| If you want to… | Read |
| --- | --- |
| Install it and get a preview running | [Getting Started](getting-started.md) |
| Look up a command or flag | [CLI Reference](cli.md) |
| Commit reusable fixtures for your team | [Seeds & Persistence](seeds.md) |
| Write unit tests for a node or credential | [Testing Harness](testing.md) |
| Understand how the mock works and what it does *not* do | [Architecture](architecture.md) |
