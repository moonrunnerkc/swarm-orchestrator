// Unit tests for the manifest reader registry.
// Three cases per reader: present (returns expected deps), absent
// (returns empty set), malformed (throws SwarmError where applicable
// or silently degrades to a subset where the format permits it).

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SwarmError } from '../../../../src/errors';
import { collectKnownDependencies } from '../../../../src/audit/cheat-detector/manifests';
import { readDependencies as readPackageJson } from '../../../../src/audit/cheat-detector/manifests/package-json';
import { readDependencies as readRequirementsTxt } from '../../../../src/audit/cheat-detector/manifests/requirements-txt';
import { readDependencies as readPyprojectToml } from '../../../../src/audit/cheat-detector/manifests/pyproject-toml';
import { readDependencies as readGoMod } from '../../../../src/audit/cheat-detector/manifests/go-mod';
import { readDependencies as readCargoToml } from '../../../../src/audit/cheat-detector/manifests/cargo-toml';
import { readDependencies as readPomXml } from '../../../../src/audit/cheat-detector/manifests/pom-xml';
import { readDependencies as readGradle } from '../../../../src/audit/cheat-detector/manifests/gradle';
import { readDependencies as readGemfile } from '../../../../src/audit/cheat-detector/manifests/gemfile';
import { readDependencies as readComposerJson } from '../../../../src/audit/cheat-detector/manifests/composer-json';
import { readDependencies as readCsproj } from '../../../../src/audit/cheat-detector/manifests/csproj';

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-readers-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function write(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content);
}

describe('manifests / package-json', () => {
  it('reads dependencies, devDependencies, peerDependencies, optionalDependencies', () => {
    withTmp((dir) => {
      write(dir, 'package.json', JSON.stringify({
        dependencies: { lodash: '*' },
        devDependencies: { jest: '*' },
        peerDependencies: { react: '*' },
        optionalDependencies: { fsevents: '*' },
      }));
      const deps = readPackageJson(dir);
      for (const name of ['lodash', 'jest', 'react', 'fsevents']) {
        assert.ok(deps.has(name), `expected ${name}`);
      }
    });
  });

  it('returns empty set when package.json is absent', () => {
    withTmp((dir) => {
      assert.equal(readPackageJson(dir).size, 0);
    });
  });

  it('throws SwarmError on malformed JSON', () => {
    withTmp((dir) => {
      write(dir, 'package.json', '{ not valid json');
      assert.throws(() => readPackageJson(dir), (err: unknown) => err instanceof SwarmError);
    });
  });
});

describe('manifests / requirements-txt', () => {
  it('reads bare names, version specs, and skips comments', () => {
    withTmp((dir) => {
      write(dir, 'requirements.txt', [
        '# comment',
        '',
        'requests',
        'flask>=2.0',
        'pytest==7.0; python_version >= "3.10"',
      ].join('\n'));
      const deps = readRequirementsTxt(dir);
      for (const name of ['requests', 'flask', 'pytest']) {
        assert.ok(deps.has(name));
      }
    });
  });

  it('returns empty set when requirements.txt is absent', () => {
    withTmp((dir) => {
      assert.equal(readRequirementsTxt(dir).size, 0);
    });
  });

  it('silently skips blank/garbage lines (best-effort, no throw)', () => {
    withTmp((dir) => {
      write(dir, 'requirements.txt', '\n\n   \n# only a comment\n');
      assert.equal(readRequirementsTxt(dir).size, 0);
    });
  });
});

describe('manifests / pyproject-toml', () => {
  it('reads PEP 621 dependencies array and Poetry tables', () => {
    withTmp((dir) => {
      write(dir, 'pyproject.toml', [
        '[project]',
        'name = "x"',
        'dependencies = ["httpx>=0.25", "rich"]',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.11"',
        'pydantic = "^2"',
      ].join('\n'));
      const deps = readPyprojectToml(dir);
      for (const name of ['httpx', 'rich', 'pydantic']) {
        assert.ok(deps.has(name), `expected ${name}`);
      }
      assert.ok(!deps.has('python'), 'should drop the python version pin');
    });
  });

  it('returns empty set when pyproject.toml is absent', () => {
    withTmp((dir) => {
      assert.equal(readPyprojectToml(dir).size, 0);
    });
  });

  it('returns a (possibly partial) set on irregular formatting (no throw)', () => {
    withTmp((dir) => {
      write(dir, 'pyproject.toml', '[tool.weird]\nfoo = "bar"\n');
      // No dep-block headers matched; result is an empty set, no throw.
      assert.equal(readPyprojectToml(dir).size, 0);
    });
  });
});

describe('manifests / go-mod', () => {
  it('reads block-form require entries', () => {
    withTmp((dir) => {
      write(dir, 'go.mod', [
        'module example.com/x',
        '',
        'go 1.22',
        '',
        'require (',
        '  github.com/stretchr/testify v1.8.0',
        '  golang.org/x/sync v0.5.0',
        ')',
      ].join('\n'));
      const deps = readGoMod(dir);
      assert.ok(deps.has('github.com/stretchr/testify'));
      assert.ok(deps.has('golang.org/x/sync'));
    });
  });

  it('returns empty set when go.mod is absent', () => {
    withTmp((dir) => {
      assert.equal(readGoMod(dir).size, 0);
    });
  });

  it('skips the module line and the literal "require" keyword', () => {
    withTmp((dir) => {
      write(dir, 'go.mod', 'module example.com/x\n\ngo 1.22\n');
      assert.equal(readGoMod(dir).size, 0);
    });
  });
});

describe('manifests / cargo-toml', () => {
  it('reads [dependencies] and [dev-dependencies]', () => {
    withTmp((dir) => {
      write(dir, 'Cargo.toml', [
        '[package]',
        'name = "x"',
        '',
        '[dependencies]',
        'serde = "1"',
        'tokio = { version = "1", features = ["full"] }',
        '',
        '[dev-dependencies]',
        'pretty_assertions = "1"',
      ].join('\n'));
      const deps = readCargoToml(dir);
      for (const name of ['serde', 'tokio', 'pretty_assertions']) {
        assert.ok(deps.has(name));
      }
    });
  });

  it('returns empty set when Cargo.toml is absent', () => {
    withTmp((dir) => {
      assert.equal(readCargoToml(dir).size, 0);
    });
  });

  it('ignores tables outside [dependencies]', () => {
    withTmp((dir) => {
      write(dir, 'Cargo.toml', '[package]\nname = "x"\n\n[features]\ndefault = []\n');
      assert.equal(readCargoToml(dir).size, 0);
    });
  });
});

describe('manifests / pom-xml', () => {
  it('reads groupId + artifactId from dependency blocks', () => {
    withTmp((dir) => {
      write(dir, 'pom.xml', [
        '<project>',
        '  <dependencies>',
        '    <dependency>',
        '      <groupId>junit</groupId>',
        '      <artifactId>junit</artifactId>',
        '      <version>4.13.2</version>',
        '      <scope>test</scope>',
        '    </dependency>',
        '    <dependency>',
        '      <groupId>com.google.guava</groupId>',
        '      <artifactId>guava</artifactId>',
        '    </dependency>',
        '  </dependencies>',
        '</project>',
      ].join('\n'));
      const deps = readPomXml(dir);
      assert.ok(deps.has('junit'));
      assert.ok(deps.has('guava'));
      assert.ok(deps.has('com.google.guava:guava'));
      assert.ok(deps.has('com.google.guava'));
    });
  });

  it('returns empty set when pom.xml is absent', () => {
    withTmp((dir) => {
      assert.equal(readPomXml(dir).size, 0);
    });
  });

  it('ignores unclosed dependency blocks gracefully', () => {
    withTmp((dir) => {
      write(dir, 'pom.xml', '<project><dependencies><dependency>');
      // No closing tag → no block captured; reader degrades to empty.
      assert.equal(readPomXml(dir).size, 0);
    });
  });
});

describe('manifests / gradle', () => {
  it('reads Groovy-DSL implementation/api/testImplementation', () => {
    withTmp((dir) => {
      write(dir, 'build.gradle', [
        "dependencies {",
        "  implementation 'com.google.guava:guava:32.0-jre'",
        '  api "org.apache.commons:commons-lang3:3.13.0"',
        "  testImplementation 'junit:junit:4.13.2'",
        '}',
      ].join('\n'));
      const deps = readGradle(dir);
      assert.ok(deps.has('guava'));
      assert.ok(deps.has('commons-lang3'));
      assert.ok(deps.has('junit'));
    });
  });

  it('reads Kotlin-DSL build.gradle.kts (parenthesized)', () => {
    withTmp((dir) => {
      write(dir, 'build.gradle.kts', [
        'dependencies {',
        '  implementation("com.squareup.okhttp3:okhttp:4.12.0")',
        '  testImplementation("io.mockk:mockk:1.13.8")',
        '}',
      ].join('\n'));
      const deps = readGradle(dir);
      assert.ok(deps.has('okhttp'));
      assert.ok(deps.has('mockk'));
    });
  });

  it('returns empty set when neither build.gradle file is present', () => {
    withTmp((dir) => {
      assert.equal(readGradle(dir).size, 0);
    });
  });
});

describe('manifests / gemfile', () => {
  it('reads gem declarations from Gemfile', () => {
    withTmp((dir) => {
      write(dir, 'Gemfile', [
        "source 'https://rubygems.org'",
        "gem 'rails', '~> 7.1'",
        'gem "rspec"',
      ].join('\n'));
      const deps = readGemfile(dir);
      assert.ok(deps.has('rails'));
      assert.ok(deps.has('rspec'));
    });
  });

  it('prefers Gemfile.lock GEM section when both present', () => {
    withTmp((dir) => {
      write(dir, 'Gemfile', "gem 'rails'\n");
      write(dir, 'Gemfile.lock', [
        'GEM',
        '  remote: https://rubygems.org/',
        '  specs:',
        '    actionpack (7.1.0)',
        '    rspec-core (3.12.0)',
        '',
        'DEPENDENCIES',
        '  rails',
      ].join('\n'));
      const deps = readGemfile(dir);
      assert.ok(deps.has('actionpack'));
      assert.ok(deps.has('rspec-core'));
    });
  });

  it('returns empty set when neither Gemfile nor Gemfile.lock is present', () => {
    withTmp((dir) => {
      assert.equal(readGemfile(dir).size, 0);
    });
  });
});

describe('manifests / composer-json', () => {
  it('reads require and require-dev (vendor/package + bare package)', () => {
    withTmp((dir) => {
      write(dir, 'composer.json', JSON.stringify({
        require: { 'symfony/console': '^6' },
        'require-dev': { 'phpunit/phpunit': '^10' },
      }));
      const deps = readComposerJson(dir);
      assert.ok(deps.has('symfony/console'));
      assert.ok(deps.has('console'));
      assert.ok(deps.has('phpunit/phpunit'));
      assert.ok(deps.has('phpunit'));
    });
  });

  it('returns empty set when composer.json is absent', () => {
    withTmp((dir) => {
      assert.equal(readComposerJson(dir).size, 0);
    });
  });

  it('throws SwarmError on malformed JSON', () => {
    withTmp((dir) => {
      write(dir, 'composer.json', '{ not json');
      assert.throws(() => readComposerJson(dir), (err: unknown) => err instanceof SwarmError);
    });
  });
});

describe('manifests / csproj', () => {
  it('reads PackageReference from a root-level csproj', () => {
    withTmp((dir) => {
      write(dir, 'MyApp.csproj', [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <ItemGroup>',
        '    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />',
        '    <PackageReference Include="Moq" Version="4.20.0" />',
        '  </ItemGroup>',
        '</Project>',
      ].join('\n'));
      const deps = readCsproj(dir);
      assert.ok(deps.has('Newtonsoft.Json'));
      assert.ok(deps.has('Moq'));
    });
  });

  it('reads PackageReference one level deep (multi-project solutions)', () => {
    withTmp((dir) => {
      const sub = path.join(dir, 'src', 'WebApi');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'WebApi.csproj'), '<Project><ItemGroup><PackageReference Include="Serilog" /></ItemGroup></Project>');
      const deps = readCsproj(dir);
      assert.ok(deps.has('Serilog'));
    });
  });

  it('returns empty set when no csproj files are present', () => {
    withTmp((dir) => {
      assert.equal(readCsproj(dir).size, 0);
    });
  });
});

describe('manifests / collectKnownDependencies fan-out', () => {
  it('unions every supported manifest', () => {
    withTmp((dir) => {
      write(dir, 'package.json', JSON.stringify({ dependencies: { lodash: '*' } }));
      write(dir, 'requirements.txt', 'requests\n');
      write(dir, 'Gemfile', "gem 'rspec'\n");
      write(dir, 'composer.json', JSON.stringify({ require: { 'symfony/console': '^6' } }));
      const deps = collectKnownDependencies(dir);
      for (const name of ['lodash', 'requests', 'rspec', 'console', 'symfony/console']) {
        assert.ok(deps.has(name), `union missing ${name}`);
      }
    });
  });

  it('returns empty set on a directory with no manifests', () => {
    withTmp((dir) => {
      assert.equal(collectKnownDependencies(dir).size, 0);
    });
  });
});
