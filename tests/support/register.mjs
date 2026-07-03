/* Registers the test-only JSON/fixtures loader. Use via:
     node --import ./tests/support/register.mjs --test tests/
   (see tests/README.md). Test-only; never imported by production code. */
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
