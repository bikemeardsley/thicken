import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Offline: R2, D1 and KV are local; AI, Images, the rate limiter and the hash lists are stubbed in the tests.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      remoteBindings: false,
      miniflare: {
        bindings: {
          SCHEMA: readFileSync('schema.sql', 'utf8'),
          ADMIN_TOKEN: 'admin-test',
          IP_SALT: 'salt-test',
          HASHCHECK_URL: 'https://hashcheck.test/v1/check',
          HASHCHECK_KEY: 'hashcheck-test',
          ARACHNID_USER: 'arachnid-user',
          ARACHNID_KEY: 'arachnid-key',
          PHOTODNA_KEY: 'photodna-test',
          NCMEC_USER: 'ncmec-user',
          NCMEC_KEY: 'ncmec-key',
        },
      },
    }),
  ],
});
