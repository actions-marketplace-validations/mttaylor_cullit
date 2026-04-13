# @cullit/config

Config loader for Cullit — YAML config parsing with environment variable resolution.

Reads `.cullit.yml` configuration files and resolves `${ENV_VAR}` placeholders from the environment. Used by all Cullit packages to load project configuration.

## Features

- **YAML parser** — Lightweight parser for `.cullit.yml` files (no external dependencies)
- **Env var resolution** — `${VAR}` and `${VAR:-default}` syntax
- **Type definitions** — Full TypeScript types for Cullit configuration
- **Config discovery** — Searches current directory and parents for `.cullit.yml`

## Install

```bash
npm install @cullit/config
```

## Usage

```ts
import { loadConfig } from '@cullit/config';

const config = loadConfig(); // finds and parses .cullit.yml
```

## Docs

- Full docs: https://cullit.io/docs
- Repository: https://github.com/mttaylor/cullit
