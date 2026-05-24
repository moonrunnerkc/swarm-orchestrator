// Integration tests for the multi-ecosystem expansion of
// mock-of-hallucination. For each new ecosystem (Maven, Gradle,
// Gemfile, composer, csproj): a broken case where the mock target
// is fabricated AND a clean case where the mock target appears in
// the relevant manifest. Together these exercise both the new
// manifest reader and the new mock-pattern matcher end-to-end.

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mockOfHallucinationDetector } from '../../../src/audit/cheat-detector/mock-of-hallucination';
import parseDiff from 'parse-diff';
import type { Finding } from '../../../src/audit/types';

interface ManifestSpec {
  name: string;
  content: string;
}

function withRepo(manifests: ManifestSpec[], fn: (repoRoot: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-eco-'));
  try {
    for (const m of manifests) {
      const full = path.join(dir, m.name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, m.content);
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runOnDiff(repoRoot: string, diff: string): Finding[] {
  return mockOfHallucinationDetector.run({ files: parseDiff(diff), repoRoot }) as Finding[];
}

function buildDiff(file: string, lines: string[]): string {
  return (
    `diff --git a/${file} b/${file}\n` +
    `--- a/${file}\n` +
    `+++ b/${file}\n` +
    `@@ -1,1 +1,${lines.length + 1} @@\n` +
    ' // existing\n' +
    lines.map((l) => `+${l}`).join('\n') +
    '\n'
  );
}

describe('mock-of-hallucination ecosystem expansion', () => {
  it('declares a 2.x detector version', () => {
    assert.ok(mockOfHallucinationDetector.version.startsWith('2.'));
  });

  describe('Java / Maven (Mockito)', () => {
    const pom = [
      '<project>',
      '  <dependencies>',
      '    <dependency>',
      '      <groupId>com.google.guava</groupId>',
      '      <artifactId>guava</artifactId>',
      '    </dependency>',
      '  </dependencies>',
      '</project>',
    ].join('\n');

    it('flags Mockito.mock for a fabricated class', () => {
      withRepo([{ name: 'pom.xml', content: pom }], (repo) => {
        const diff = buildDiff('src/test/java/X.java', [
          '  ImaginaryService svc = Mockito.mock(com.example.imaginary.ImaginaryService.class);',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 1);
        assert.equal(findings[0]?.severity, 'block');
      });
    });

    it('does not flag Mockito.mock when target resolves to a declared artifact', () => {
      withRepo([{ name: 'pom.xml', content: pom }], (repo) => {
        const diff = buildDiff('src/test/java/X.java', [
          '  Cache cache = Mockito.mock(com.google.common.cache.guava.class);',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 0);
      });
    });
  });

  describe('Kotlin / Gradle (mockk)', () => {
    const gradle =
      "dependencies {\n" +
      "  implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n" +
      "  testImplementation 'io.mockk:mockk:1.13.8'\n" +
      '}\n';

    it('flags mockk<...> for a fabricated class', () => {
      withRepo([{ name: 'build.gradle', content: gradle }], (repo) => {
        const diff = buildDiff('src/test/kotlin/X.kt', [
          '  val s = mockk<com.example.imaginary.NeverHeardOfYou>()',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 1);
      });
    });

    it('does not flag mockk<...> when target resolves to a declared dep', () => {
      withRepo([{ name: 'build.gradle', content: gradle }], (repo) => {
        const diff = buildDiff('src/test/kotlin/X.kt', [
          '  val client = mockk<okhttp.OkHttpClient>()',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 0);
      });
    });
  });

  describe('Ruby / Gemfile (RSpec)', () => {
    const gemfile = "source 'https://rubygems.org'\ngem 'rails'\ngem 'rspec'\n";

    it('flags instance_double for a fabricated class', () => {
      withRepo([{ name: 'Gemfile', content: gemfile }], (repo) => {
        const diff = buildDiff('spec/x_spec.rb', [
          "  allow(svc).to receive(:foo).and_return(instance_double('Imaginary::Service'))",
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 1);
      });
    });

    it('does not flag instance_double when target resolves to a declared gem', () => {
      withRepo([{ name: 'Gemfile', content: gemfile }], (repo) => {
        const diff = buildDiff('spec/x_spec.rb', [
          '  allow_any_instance_of(Rails::Application) { |a| }',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 0);
      });
    });
  });

  describe('PHP / composer (PHPUnit)', () => {
    const composer = JSON.stringify({
      require: { 'symfony/console': '^6' },
      'require-dev': { 'phpunit/phpunit': '^10' },
    });

    it('flags createMock for a fabricated class', () => {
      withRepo([{ name: 'composer.json', content: composer }], (repo) => {
        const diff = buildDiff('tests/XTest.php', [
          '    $mock = $this->createMock(App\\Imaginary\\NeverShipped::class);',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 1);
      });
    });

    it('does not flag createMock when target resolves to a declared package', () => {
      withRepo([{ name: 'composer.json', content: composer }], (repo) => {
        const diff = buildDiff('tests/XTest.php', [
          '    $mock = $this->createMock(symfony\\Console\\Command::class);',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 0);
      });
    });
  });

  describe('C# / csproj (Moq, NSubstitute)', () => {
    const csproj =
      '<Project Sdk="Microsoft.NET.Sdk">\n' +
      '  <ItemGroup>\n' +
      '    <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />\n' +
      '    <PackageReference Include="Moq" Version="4.20.0" />\n' +
      '  </ItemGroup>\n' +
      '</Project>\n';

    it('flags new Mock<IFoo>() for a fabricated interface', () => {
      withRepo([{ name: 'App.csproj', content: csproj }], (repo) => {
        const diff = buildDiff('Tests/XTest.cs', [
          '  var mock = new Mock<App.Imaginary.INeverHeardOfYou>();',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 1);
      });
    });

    it('does not flag NSubstitute.For<...> when target resolves to a declared package', () => {
      withRepo([{ name: 'App.csproj', content: csproj }], (repo) => {
        const diff = buildDiff('Tests/XTest.cs', [
          '  var json = Substitute.For<Newtonsoft.Json.JsonConvert>();',
        ]);
        const findings = runOnDiff(repo, diff);
        assert.equal(findings.length, 0);
      });
    });
  });
});
