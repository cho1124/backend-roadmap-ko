# 04 - Stage 2: Node.js 런타임과 비동기 (4주)

> 허브: [00-백엔드 학습 허브](00-백엔드-학습-허브.md) · 이전: [03-Stage 1 — HTTP와 웹의 동작 원리](03-stage1-HTTP와-웹의-동작-원리.md)

---

## 이 스테이지의 질문

> **스레드 하나로 어떻게 수천 명을 동시에 상대하는가?**

이것이 Node.js의 존재 이유이자, 강점과 약점을 동시에 만드는 단 하나의 설계 결정이다.
이 질문에 답할 수 있으면 "Node가 어디에 맞고 어디에 안 맞는지"가 자동으로 나온다.

---

## 1주차 — 이벤트 루프

### 문제 상황부터

서버가 요청을 처리하는 시간의 대부분은 **계산이 아니라 기다림**이다.

```
요청 처리 10ms 중:
  ├─ 0.2ms  요청 파싱          (CPU)
  ├─ 8.0ms  DB 응답 대기        (기다림) ← 96%
  ├─ 1.5ms  외부 API 대기       (기다림)
  └─ 0.3ms  응답 조립          (CPU)
```

**전통적 해법 (스레드 방식)**: 요청 1개당 스레드 1개.
기다리는 동안 그 스레드는 잠들고, OS가 다른 스레드로 전환한다.

문제: 스레드는 비싸다. 각각 메모리(~1MB 스택)를 먹고, 전환 비용이 있다.
동시 접속 10,000명이면 스레드 10,000개 → 메모리 10GB + 전환 지옥.
이게 그 유명한 **C10K 문제**다.

**Node의 해법**: 스레드를 늘리지 말고, **기다리는 동안 다른 일을 하자.**

```
스레드 1개 + 이벤트 루프

while (true) {
  완료된 I/O 있나? → 있으면 해당 콜백 실행
  타이머 만료됐나? → 있으면 해당 콜백 실행
  할 일 없으면    → OS에게 "뭐라도 생기면 깨워줘" 하고 잠듦
}
```

### 이 설계가 만드는 단 하나의 규칙

```
콜백 하나하나가 "짧게" 끝나야 한다.
어느 콜백에서든 5초 걸리는 계산을 하면 → 서버 전체가 5초간 얼어붙는다.
                                       (접속한 모든 사용자에게)
```

일반적인 단일 스레드 루프 구조를 다뤄봤다면 익숙한 제약이다.
차이는 **영향 범위**다. 여기서는 나 혼자가 아니라 **전원**이 멈춘다.

### 블로킹 vs 논블로킹

```ts
import fs from 'node:fs';

// 블로킹 — 파일 다 읽을 때까지 이벤트 루프가 멈춘다
const data = fs.readFileSync('big.json');   // ❌ 서버에서 금지

// 논블로킹 — 읽는 동안 다른 요청을 처리한다
const data = await fs.promises.readFile('big.json');   // ✅
```

> **규칙**: 이름에 `Sync`가 붙은 함수는 **서버 시작 시점(설정 로딩 등)에만** 쓴다.
> 요청 처리 경로에 들어가면 안 된다.

### 그럼 진짜로 스레드가 하나인가?

정확히는 **"JS 코드를 실행하는 스레드가 하나"**다.
파일 I/O·DNS·압축 같은 것은 내부적으로 **libuv의 스레드 풀**(기본 4개)이 처리한다.

```
[ JS 실행 스레드 ]  ← 내 코드는 여기서만 돈다. 여기가 막히면 끝.
       ↕
[ libuv 스레드풀 ]  ← 파일 I/O, 암호화, 압축
       ↕
[ OS 커널 (epoll/kqueue/IOCP) ]  ← 네트워크 I/O는 아예 커널이 알림
```

**네트워크 I/O는 스레드조차 안 쓴다** — OS가 "데이터 도착함"을 알려주는 방식이다.
그래서 Node는 네트워크 중심 작업에 특히 강하다.

### 🔧 마이크로 실습 (40분) — 서버 얼려보기

**이 스테이지 전체에서 가장 중요한 실습이다.**

```ts
// block-demo.ts
import http from 'node:http';

http.createServer((req, res) => {
  if (req.url === '/fast') {
    res.end('fast\n');
    return;
  }

  if (req.url === '/slow') {
    // CPU를 3초간 점유 (블로킹)
    const end = Date.now() + 3000;
    while (Date.now() < end) { /* 순수 CPU 낭비 */ }
    res.end('slow\n');
    return;
  }

  res.statusCode = 404;
  res.end();
}).listen(3000);
```

**실험:**
1. 터미널 A: `curl localhost:3000/slow` (3초 걸림)
2. **동시에** 터미널 B: `curl localhost:3000/fast`
3. 관찰: `/fast`가 **즉시 응답하지 않고 `/slow`가 끝날 때까지 기다린다**

**추가 실험:** `while` 루프를 `await new Promise(r => setTimeout(r, 3000))`으로 바꾸면?
→ `/fast`가 즉시 응답한다.

> **결론: 기다림은 괜찮고, 계산은 안 괜찮다.**
> "Node에서 CPU 무거운 작업이 왜 위험한가"를 머리가 아니라 눈으로 확인하는 것이 이 실습의 목적이다.

---

## 2주차 — Promise와 async/await

### 기본

```ts
// Promise = 미래에 올 값
const promise: Promise<User> = fetchUser(42);

// async/await = 그 값을 동기 코드처럼 쓰는 문법
const user = await fetchUser(42);
```

**알아둘 성질 하나**: JS의 `Promise`는 **생성 즉시 실행이 시작된다(eager)**.

```ts
const p = fetchUser(42);   // ← 여기서 이미 요청이 나갔다
await someOtherThing();
const user = await p;      // await는 "결과를 받는" 시점일 뿐, 시작 시점이 아니다
```

이 성질이 다음 최적화의 근거다.

### 순차 vs 병렬 — 여기서 실력이 갈린다

```ts
// ❌ 순차 — 300ms
const user  = await getUser(id);      // 100ms
const posts = await getPosts(id);     // 100ms
const likes = await getLikes(id);     // 100ms

// ✅ 병렬 — 100ms (서로 의존하지 않으므로)
const [user, posts, likes] = await Promise.all([
  getUser(id), getPosts(id), getLikes(id),
]);
```

**더 흔하고 더 비싼 실수는 루프 안의 await다:**

```ts
// ❌ 항목 100개 × 20ms = 2초
for (const id of ids) {
  results.push(await fetchDetail(id));
}
```

이것이 **"비용을 항목마다 치르는"** 패턴이고,
Stage 3의 N+1 쿼리 문제와 **정확히 같은 병리**다. 이름만 다르다.

**다만 무제한 병렬도 위험하다:**
```ts
// ❌ 항목 1000개 → 동시 요청 1000개 → 상대 서버 다운 or 커넥션 풀 고갈
await Promise.all(items.map(item => fetchDetail(item)));

// ✅ 동시 실행 개수 제한 (p-limit 등) 또는 청크 분할
```

### Promise 조합 함수 4개

| 함수 | 동작 | 쓰는 곳 |
|---|---|---|
| `Promise.all` | 전부 성공해야 성공, 하나 실패하면 즉시 실패 | 기본값 |
| `Promise.allSettled` | 전부 끝날 때까지 기다림, 성공/실패 각각 보고 | 일부 실패를 허용할 때 |
| `Promise.race` | 가장 먼저 끝난 것 | **타임아웃 구현** |
| `Promise.any` | 가장 먼저 **성공**한 것 | 여러 후보 중 아무거나 |

```ts
// 타임아웃 패턴 — 서버에서 필수
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}
```

**타임아웃 없는 외부 호출은 서버를 죽인다.** 상대가 응답을 안 주면
내 커넥션·메모리가 무한정 쌓인다.
[01-백엔드의 5가지 근본 전제](01-백엔드의-5가지-근본-전제.md) ③(실패가 정상 경로)의 구체적 구현이다.

### 에러 처리 — 서버가 통째로 죽는 두 가지

```ts
// ① 잡히지 않은 Promise 거부
somethingAsync();          // ❌ await도 .catch()도 없음
// → unhandledRejection. Node 15+ 부터 기본적으로 프로세스가 죽는다

// ② async 콜백 안의 예외
app.get('/x', async (req, res) => {
  throw new Error('boom');  // ❌ 프레임워크가 못 잡을 수 있음
});
```

> **계율**: 서버 코드에서 **모든 async 호출은 await되거나 .catch()가 붙어야 한다.**
> 일반 프로그램에서 예외 하나 흘리면 로그 한 줄이지만,
> 서버에서는 프로세스가 죽고 접속자 전원이 끊긴다.

### 🔧 마이크로 실습 (40분)

```ts
const delay = (ms: number, label: string) =>
  new Promise<string>(r => setTimeout(() => r(label), ms));

// 실험 1: 순차 vs 병렬 시간 측정
console.time('sequential');
await delay(300, 'a'); await delay(300, 'b'); await delay(300, 'c');
console.timeEnd('sequential');            // ~900ms

console.time('parallel');
await Promise.all([delay(300,'a'), delay(300,'b'), delay(300,'c')]);
console.timeEnd('parallel');              // ~300ms

// 실험 2: all vs allSettled — 하나를 실패시켜서 차이 관찰
// 실험 3: race로 타임아웃 만들어서 느린 작업 잘라내기
```

---

## 3주차 — 모듈과 npm 생태계

### 모듈 시스템 두 개 (혼란의 원인)

| | CommonJS (구) | ES Modules (현재 표준) |
|---|---|---|
| 가져오기 | `require('x')` | `import x from 'x'` |
| 내보내기 | `module.exports = x` | `export default x` |
| 로딩 | 동기 | 비동기 |
| 상태 | 레거시(여전히 많음) | **신규 프로젝트는 이걸 쓴다** |

`package.json`에 `"type": "module"` 을 넣으면 ESM이 된다. **새로 시작하면 ESM.**

옛날 튜토리얼과 최신 문서의 문법이 다른 이유가 이것이다. 당황하지 않는다.

### npm — 축복이자 저주

```bash
npm install express      # dependencies (실행에 필요)
npm install -D vitest    # devDependencies (개발에만 필요)
npm ci                   # package-lock.json 그대로 설치 (CI/배포용)
```

**핵심 파일 2개:**
- `package.json` — 내가 원하는 것 (`"express": "^5.0.0"` — 범위)
- `package-lock.json` — 실제로 설치된 것 (정확한 버전) → **반드시 커밋한다**

lock 파일을 커밋 안 하면 "내 PC에선 되는데요"가 발생한다.
`npm install`은 범위 안에서 버전을 올릴 수 있고, `npm ci`는 lock 그대로 설치한다.

### 패키지 하나 추가하기 전 체크리스트

Node 생태계의 최대 위험은 **의존성 폭발**이다. 패키지 하나가 100개를 끌고 온다.

- [ ] 표준 라이브러리(`node:`)로 되는 일 아닌가? (최근 Node 내장은 상당히 풍부하다)
- [ ] 최근 1년 안에 커밋이 있나?
- [ ] 의존성이 몇 개나 딸려오나? (`npm ls`로 확인)
- [ ] 주간 다운로드가 극단적으로 적지 않나?
- [ ] 30줄로 직접 짤 수 있는 것 아닌가?

**보안 관점**: 설치하는 패키지는 **내 서버에서 임의 코드를 실행할 권한**을 갖는다.
공급망 공격이 실재한다. Stage 5에서 다시 다룬다.

### 알아둘 내장 모듈

```ts
import http   from 'node:http';    // 서버
import fs     from 'node:fs';      // 파일 (fs/promises 를 쓴다)
import path   from 'node:path';    // 경로 조합 (문자열 + 금지)
import crypto from 'node:crypto';  // 해시, 랜덤, UUID
import url    from 'node:url';     // URL 파싱
import os     from 'node:os';      // CPU 개수 등
```

`node:` 접두사를 붙이는 게 현재 권장 방식이다 (npm 패키지와의 혼동 방지).

---

## 4주차 — 스트림과 마무리

### 스트림 — 다 안 읽고 흘려보내기

```ts
// ❌ 1GB 파일을 통째로 메모리에 올림 → 동시 요청 10개면 10GB
const data = await fs.promises.readFile('huge.csv');
res.end(data);

// ✅ 조각조각 흘려보냄 → 메모리는 항상 일정
fs.createReadStream('huge.csv').pipe(res);
```

**핵심 사고**: 데이터 크기가 메모리 사용량을 결정하면 안 된다.
스트림은 **"전체 크기와 무관하게 일정한 메모리"**를 보장한다.

**백프레셔(backpressure)**: 읽는 속도 > 쓰는 속도이면 메모리가 쌓인다.
`pipe()`는 이걸 자동으로 조절해준다. 수동으로 스트림을 다루면 직접 처리해야 한다.

### TypeScript — 빌드 없이 실행된다

최신 Node는 **`.ts` 파일을 빌드 없이 바로 실행**한다 (타입 스트리핑).

```bash
node index.ts     # 그냥 된다
```

**단, 알아야 할 한계** (자세히는 [11-2026 생태계 현황 스냅샷](11-2026-생태계-현황-스냅샷.md)):
- 타입을 **지우기만** 한다 → 타입 검사는 안 해준다. 검사는 `tsc --noEmit` 또는 에디터가 한다
- `tsconfig.json`의 `paths` 같은 건 반영 안 된다
- `enum`, `namespace` 등 "지우기만 해서는 안 되는" 문법은 제약이 있다

> **학습 전략**: 처음 2주는 타입을 최소한으로만 쓴다.
> 빌드 도구·tsconfig 튜닝은 학습이 아니라 세팅이다.
> 타입 검사가 필요해지면 그때 `tsc --noEmit`을 붙인다.

### CPU 무거운 작업은 어떻게?

1주차 실험에서 본 문제의 해법.

| 방법 | 언제 |
|---|---|
| **Worker Threads** | 이미지 처리, 압축 등 CPU 작업 |
| **작업 큐 + 별도 프로세스** | 무거운 배치 작업 (권장) |
| **다른 서비스로 분리** | 진짜 무거우면 Node가 아닌 언어로 |
| **`cluster` / 프로세스 여러 개** | CPU 코어 활용 (Stage 6) |

교양 수준에서는 **"Node는 I/O 중심에 강하고 CPU 중심에 약하다"**는 결론과
그 이유를 설명할 수 있으면 충분하다.

### 🔧 마이크로 실습 (40분)

- [ ] 큰 파일(100MB)을 `readFile` vs `createReadStream`으로 응답하고 메모리 사용량 비교
- [ ] `process.memoryUsage()` 찍어보기
- [ ] 서버에 `/health` 엔드포인트 추가 (Stage 6에서 쓴다)
- [ ] 요청마다 소요 시간을 로그로 남기기 (관측 가능성의 첫걸음)

---

## ▶ P1 실습 프로젝트

Stage 1 + 2를 묶는 지점. [09-실습 프로젝트 3단계](09-실습-프로젝트-3단계.md)의 P1을 진행한다.

---

## 이 스테이지의 함정

| 함정 | 교정 |
|---|---|
| "싱글 스레드니까 느리다" | I/O 중심에서는 오히려 빠르다. **CPU 중심에서만** 약하다 |
| 콜백/Promise/async 혼용 | 신규 코드는 async/await만 쓴다 |
| `await`를 루프 안에 넣기 | 의존성 없으면 `Promise.all` 또는 배치 |
| 타임아웃 안 걸기 | 외부 호출에는 항상 건다 |
| 패키지 남발 | 체크리스트를 거친다 |
| 세팅에 시간 쓰기 | 타입/빌드 설정 튜닝은 나중에 |

---

## 자가 점검

1. 이벤트 루프가 무엇이고, 왜 그렇게 설계됐는가? (C10K 문제부터)
2. `/slow` 실험에서 왜 `/fast`까지 멈췄는가? 그 영향 범위는?
3. Node에서 "스레드가 하나"라는 말은 정확히 무엇이 하나라는 뜻인가?
4. 순차 await 3개와 `Promise.all`의 시간 차이와 그 원리는?
5. `Promise.all`과 `allSettled`는 언제 갈라 쓰는가?
6. 외부 API 호출에 타임아웃을 안 걸면 어떤 일이 생기는가?
7. 스트림이 필요한 이유를 메모리 관점에서 설명해보라
8. `npm install`과 `npm ci`의 차이는?

---

## 참고 자료

| 자료 | 용도 |
|---|---|
| **Node.js 공식 문서 — Guides** | 이벤트 루프·타이머 문서가 특히 좋다 |
| **MDN — Promise / async function** | 문법 레퍼런스 |
| **"What the heck is the event loop anyway?"** (Philip Roberts, 강연) | 시각적 설명. 26분. **강력 추천** |
| `node --inspect` / `--prof` | 프로파일링 |

---

## 결론

> Node의 모든 특성은 **"스레드를 늘리는 대신 기다림을 겹치자"**는 단 하나의 결정에서 나온다.
>
> 그래서 I/O가 많은 일에는 압도적으로 효율적이고,
> CPU를 오래 쓰는 일에는 치명적으로 취약하다.
>
> 이 한 문장을 이해하면 Node의 나머지 특성은 전부 여기서 유도된다.

*태그: 백엔드 · Node · 비동기 · 이벤트루프 · Stage2*
