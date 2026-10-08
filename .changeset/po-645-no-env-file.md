---
"@revenexx/integrations-node-devkit": minor
---

The devkit reads no env file any more. `--env` and `--no-env` are gone and say where the credential comes from instead, and a `${VAR}` in a seed is taken literally rather than filled from the environment. A credential with a secret is created in the preview's Credentials dialog and confirmed with **Connect**, the way a customer creates it; seeds keep fixed values such as a local SMTP container. `interpolateEnv`, `loadEnvFile`, `resolveEnvFile`, `nodeOwnedEnvFlag` and `ENV_FILE_MIN_NODE` are no longer exported.

`run` and `preview` set `RVNXX_SSRF_ALLOW_PRIVATE=1` unless it is already set, as the local stack does, so a node can reach a service on localhost without any setup.
