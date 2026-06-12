import { strict as assert } from 'assert';
import {
  looksLikeSecretName,
  sanitizedChildEnv,
} from '../../src/shared/child-env';

describe('shared/child-env', () => {
  describe('looksLikeSecretName', () => {
    it('flags the named credentials the auditor holds', () => {
      assert.equal(looksLikeSecretName('ANTHROPIC_API_KEY'), true);
      assert.equal(looksLikeSecretName('OPENAI_API_KEY'), true);
      assert.equal(looksLikeSecretName('GITHUB_TOKEN'), true);
      assert.equal(looksLikeSecretName('NPM_TOKEN'), true);
    });

    it('flags names that match the common credential suffixes', () => {
      assert.equal(looksLikeSecretName('CUSTOM_TOKEN'), true);
      assert.equal(looksLikeSecretName('MY_SECRET'), true);
      assert.equal(looksLikeSecretName('DB_PASSWORD'), true);
      assert.equal(looksLikeSecretName('REPO_PRIVATE_KEY'), true);
      assert.equal(looksLikeSecretName('THIRD_PARTY_API_KEY'), true);
    });

    it('flags vendor-prefixed buckets', () => {
      assert.equal(looksLikeSecretName('AWS_ACCESS_KEY_ID'), true);
      assert.equal(looksLikeSecretName('AZURE_CLIENT_SECRET'), true);
      assert.equal(looksLikeSecretName('NPM_CONFIG_USERCONFIG'), true);
    });

    it('lets ordinary toolchain vars through', () => {
      assert.equal(looksLikeSecretName('PATH'), false);
      assert.equal(looksLikeSecretName('HOME'), false);
      assert.equal(looksLikeSecretName('NODE_ENV'), false);
      assert.equal(looksLikeSecretName('LANG'), false);
      assert.equal(looksLikeSecretName('SHELL'), false);
    });
  });

  describe('sanitizedChildEnv', () => {
    it('removes known credentials from the child environment', () => {
      const child = sanitizedChildEnv({
        PATH: '/usr/bin',
        HOME: '/home/dev',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
        OPENAI_API_KEY: 'sk-openai-secret',
        GITHUB_TOKEN: 'ghp_xyz',
        NPM_TOKEN: 'npm_secret',
      });
      assert.equal(child.PATH, '/usr/bin');
      assert.equal(child.HOME, '/home/dev');
      assert.equal(child.ANTHROPIC_API_KEY, undefined);
      assert.equal(child.OPENAI_API_KEY, undefined);
      assert.equal(child.GITHUB_TOKEN, undefined);
      assert.equal(child.NPM_TOKEN, undefined);
    });

    it('also removes pattern-matched credentials', () => {
      const child = sanitizedChildEnv({
        PATH: '/usr/bin',
        APP_DATABASE_PASSWORD: 'hunter2',
        APP_SESSION_TOKEN: 'tok',
        AWS_ACCESS_KEY_ID: 'AKIA...',
      });
      assert.equal(child.PATH, '/usr/bin');
      assert.equal(child.APP_DATABASE_PASSWORD, undefined);
      assert.equal(child.APP_SESSION_TOKEN, undefined);
      assert.equal(child.AWS_ACCESS_KEY_ID, undefined);
    });

    it('restores process.env when SWARM_SANDBOX_ENV=passthrough', () => {
      const source: NodeJS.ProcessEnv = {
        SWARM_SANDBOX_ENV: 'passthrough',
        GITHUB_TOKEN: 'ghp_xyz',
      };
      const child = sanitizedChildEnv(source);
      assert.equal(child, source);
      assert.equal(child.GITHUB_TOKEN, 'ghp_xyz');
    });
  });
});
