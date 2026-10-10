# headpress-sdk-js

Monorepo of [`@meumouse/headpress`](packages/headpress), the typed, framework-agnostic client for
Headpress, the headless commerce engine for WordPress and WooCommerce.

| Path | What it is |
| --- | --- |
| `packages/headpress` | The published package |
| `contract/` | The Headpress contract snapshot the types are generated from |
| `scripts/` | `contract-pull.mjs` and `codegen.mjs` |

## Development

```bash
pnpm install
pnpm check        # typecheck, test, build, package lint, size limit
```

### Updating the contract

When Headpress changes its public config, pull the contract from a site running the new version and
regenerate the types:

```bash
pnpm contract:pull --url http://headpress.local --plugin "/path/to/wp-content/plugins/headpress"
pnpm codegen
```

CI fails when `src/generated/store-config.ts` does not match `contract/` (`pnpm codegen --check`).

### Releasing

Every change that affects the package gets a changeset (`pnpm changeset`). Releases are published
from CI with npm provenance.

## License

MIT © MeuMouse.com
