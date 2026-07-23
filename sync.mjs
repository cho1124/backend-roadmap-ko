#!/usr/bin/env node
/**
 * 볼트(Obsidian) → 저장소 동기화
 *
 *   node sync.mjs           변경분을 저장소에 반영
 *   node sync.mjs --check   반영하지 않고 차이만 보고 (CI/커밋 전 확인용)
 *
 * 볼트 경로는 BACKEND_VAULT 환경변수로 덮어쓸 수 있다.
 *
 * 두 폴더는 같은 포맷(표준 MD 링크 + 하이픈 파일명)을 쓰므로 보통은 단순 복사다.
 * 다만 Obsidian이 링크를 [[위키링크]]로, 태그를 "#태그" 줄로 되돌려놓는 경우가 있어
 * 복사 전에 그 두 가지를 GitHub 포맷으로 정규화한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.BACKEND_VAULT
  ?? 'C:/Users/WINTEK/Desktop/Personal/Obsidian-Vault/02-학습/백엔드';

const CHECK_ONLY = process.argv.includes('--check');

/** 문서 파일명 목록 = 정본. 여기 없는 파일은 동기화하지 않는다. */
const DOCS = [
  '00-백엔드-학습-허브.md',
  '01-백엔드의-5가지-근본-전제.md',
  '02-6개월-로드맵.md',
  '03-stage1-HTTP와-웹의-동작-원리.md',
  '04-stage2-Node-런타임과-비동기.md',
  '05-stage3-데이터베이스와-SQL.md',
  '06-stage4-API-설계.md',
  '07-stage5-인증과-보안.md',
  '08-stage6-배포와-운영.md',
  '09-실습-프로젝트-3단계.md',
  '10-백엔드-용어-사전.md',
  '11-2026-생태계-현황-스냅샷.md',
];

/** 노트 제목(확장자 없음) → 파일명. Obsidian이 만든 위키링크를 되돌리는 데 쓴다. */
const BY_TITLE = Object.fromEntries(DOCS.map(f => [f.replace(/\.md$/, ''), f]));

const problems = [];

function normalize(text, file) {
  // ① [[위키링크]] / [[위키링크|별칭]] → [별칭](파일.md)
  text = text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (full, target, alias) => {
    const dest = BY_TITLE[target.trim()];
    if (!dest) { problems.push(`${file}: 알 수 없는 위키링크 [[${target.trim()}]]`); return full; }
    return `[${(alias ?? target).trim()}](${dest})`;
  });

  // ② 줄 전체가 "#태그 #태그 …" 인 경우 → 이탤릭 각주 (GitHub이 H1으로 렌더링하는 것 방지)
  text = text.replace(/^#([^\s#].*)$/gm, (line) => {
    const tags = line.match(/#[^\s#]+/g);
    if (!tags || tags.length < 2) return line;   // 진짜 제목은 건드리지 않음
    return `*태그: ${tags.map(t => t.slice(1)).join(' · ')}*`;
  });

  return text.replace(/\r\n/g, '\n');
}

if (!fs.existsSync(VAULT)) {
  console.error(`볼트 경로를 찾을 수 없습니다: ${VAULT}`);
  console.error('BACKEND_VAULT 환경변수로 경로를 지정하세요.');
  process.exit(1);
}

const changed = [];
let missing = 0;

for (const doc of DOCS) {
  const src = path.join(VAULT, doc);
  const dst = path.join(REPO, doc);

  if (!fs.existsSync(src)) { problems.push(`볼트에 없음: ${doc}`); missing++; continue; }

  const next = normalize(fs.readFileSync(src, 'utf8'), doc);
  const prev = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8').replace(/\r\n/g, '\n') : null;

  if (prev === next) continue;
  changed.push(doc);
  if (!CHECK_ONLY) fs.writeFileSync(dst, next, 'utf8');
}

// ③ 링크 대상이 실제로 존재하는지 확인
for (const doc of DOCS) {
  const p = path.join(REPO, doc);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  for (const m of text.matchAll(/\]\(([^)#:]+?\.md)\)/g)) {
    if (!fs.existsSync(path.join(REPO, m[1]))) problems.push(`${doc}: 깨진 링크 → ${m[1]}`);
  }
}

console.log(`볼트:   ${VAULT}`);
console.log(`저장소: ${REPO}\n`);

if (changed.length === 0 && missing === 0) {
  console.log('변경 없음 — 이미 동기화되어 있습니다.');
} else {
  console.log(`${CHECK_ONLY ? '변경될 파일' : '반영된 파일'} ${changed.length}개`);
  changed.forEach(f => console.log('  ' + f));
}

if (problems.length) {
  console.log('\n⚠️  확인 필요:');
  problems.forEach(p => console.log('  - ' + p));
  process.exit(1);
}

if (!CHECK_ONLY && changed.length) {
  console.log('\n다음 단계: git add -A && git commit && git push');
}
