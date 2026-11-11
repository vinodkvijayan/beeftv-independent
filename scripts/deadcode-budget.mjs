#!/usr/bin/env node
// 死代码只许减不许增：把 `go tool deadcode` 的结果规范成 `包路径.函数名`，
// 与 scripts/deadcode-baseline.txt 比较。行号不进入基线，改代码行不会产生新条目。
//
// 基线必须能在 Linux、macOS、Windows 三种发布构建上同时成立，否则平台专属文件
// （例如只在 proxy_darwin.go 里调用的 parseMacProxy）会被另一个平台误报为死代码。
// 所以按三个目标平台分别分析，只保留三边都不可达的函数。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const baselinePath = path.join(root, 'scripts', 'deadcode-baseline.txt');
const update = process.argv.includes('--update');

const targets = [
  { goos: 'linux', goarch: 'amd64' },
  { goos: 'darwin', goarch: 'amd64' },
  { goos: 'windows', goarch: 'amd64' },
];

function normalize(output) {
  const entries = new Set();
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+?):\d+:\d+: unreachable func: (.+)$/);
    if (!match) continue;
    const packagePath = path.posix.dirname(match[1].replace(/\\/g, '/'));
    entries.add(`${packagePath}.${match[2]}`);
  }
  return [...entries].sort();
}

function deadcodeBinary() {
  // 必须用宿主平台的 deadcode 可执行文件；直接 `GOOS=windows go tool deadcode`
  // 会尝试构建并运行 Windows 程序。这里只让被测包使用目标平台环境。
  const env = { ...process.env };
  delete env.GOOS;
  delete env.GOARCH;
  delete env.CGO_ENABLED;
  try {
    return execFileSync('go', ['tool', '-n', 'deadcode'], {
      cwd: backend,
      env,
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    }).trim();
  } catch (error) {
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
}

function analyze(binary) {
  const perPlatform = [];
  for (const target of targets) {
    let output;
    try {
      output = execFileSync(binary, ['./cmd/...'], {
        cwd: backend,
        env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      });
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(`${target.goos}/${target.goarch}: ${detail}`);
    }
    perPlatform.push({ target, entries: normalize(output) });
  }
  const sets = perPlatform.map((platform) => new Set(platform.entries));
  const intersection = perPlatform[0].entries.filter((entry) => sets.every((set) => set.has(entry)));
  const counts = perPlatform.map((platform) => `${platform.target.goos} ${platform.entries.length}`).join(' / ');
  return { entries: intersection, counts };
}

function readBaseline() {
  if (!existsSync(baselinePath)) {
    if (update) return null;
    throw new Error(`Missing baseline file${path.relative(root, baselinePath)}, first run node scripts/deadcode-budget.mjs --update to generate it`);
  }
  return [...new Set(readFileSync(baselinePath, 'utf8').split('\n').filter(Boolean))].sort();
}

let current;
try {
  const binary = deadcodeBinary();
  const analysis = analyze(binary);
  console.log(`Number of dead codes per platform:${analysis.counts};Intersection of three platforms${analysis.entries.length} item.`);
  current = analysis.entries;
} catch (error) {
  console.error(`Running go tool deadcode fails:${error.message}`);
  process.exit(1);
}

const baseline = readBaseline();
if (baseline === null) {
  writeFileSync(baselinePath, `${current.join('\n')}\n`);
  console.log(`Baseline generated:${current.length} item.`);
  process.exit(0);
}
const baselineSet = new Set(baseline);
const currentSet = new Set(current);
const added = current.filter((entry) => !baselineSet.has(entry));
const gone = baseline.filter((entry) => !currentSet.has(entry));

if (update) {
  if (added.length > 0) {
    console.error('The current result contains new dead code outside the baseline, and the baseline is refused to be updated:');
    for (const entry of added) console.error(`  ${entry}`);
    console.error('Delete it, or move it to _test.go and run --update again.');
    process.exit(1);
  }
  writeFileSync(baselinePath, `${current.join('\n')}\n`);
  console.log(`The baseline has been tightened:${baseline.length} → ${current.length} item.`);
  process.exit(0);
}

if (added.length > 0) {
  console.error(`discover${added.length} Dead code that is not included in the baseline:`);
  for (const entry of added) console.error(`  ${entry}`);
  console.error('Delete it, or move it to _test.go.');
  process.exit(1);
}

if (gone.length > 0) {
  console.log(`Better: There is in the baseline${gone.length} Item no longer exists:`);
  for (const entry of gone) console.log(`  ${entry}`);
  console.log('Run node scripts/deadcode-budget.mjs --update to tighten the baseline.');
}

console.log(`Dead code check passed: currently${current.length} item, baseline${baseline.length} item.`);
