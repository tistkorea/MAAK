#!/usr/bin/env node
// MPS 주방프린터 브릿지 에이전트 (의존성 없음, Node 18+)
//
// 매장 PC에서 실행 → POS의 주방프린터 주소를 이 PC:9100 으로 변경.
// POS가 보낸 ESC/POS 전표를 (1) MPS 서버로 전송해 KDS에 표시하고
// (2) FORWARD_PRINTER 가 설정되면 실제 프린터로 그대로 전달(종이 백업)한다.
// 서버 장애 시 spool 폴더에 저장하고 주기적으로 재전송한다.
//
// 환경변수
//   MPS_SERVER       예) https://mps.example.com
//   MPS_DEVICE_KEY   관리화면 > POS·프린터 연결에서 발급한 키
//   LISTEN_PORT      기본 9100
//   FORWARD_PRINTER  예) 192.168.0.50:9100 (선택)
//   PRINTER_ENCODING 기본 euc-kr
//   SPOOL_DIR        기본 ./spool
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SERVER = (process.env.MPS_SERVER || 'http://localhost:4000').replace(/\/$/, '');
const KEY = process.env.MPS_DEVICE_KEY;
const PORT = Number(process.env.LISTEN_PORT || 9100);
const FORWARD = process.env.FORWARD_PRINTER;
const ENCODING = process.env.PRINTER_ENCODING || 'euc-kr';
const SPOOL = path.resolve(process.env.SPOOL_DIR || './spool');
const IDLE_MS = 400; // 전표 1건 종료 판단(연결 유지형 POS 대비)

if (!KEY) {
  console.error('MPS_DEVICE_KEY 가 필요합니다');
  process.exit(1);
}
fs.mkdirSync(SPOOL, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function send(job) {
  const res = await fetch(`${SERVER}/api/pos/print`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Device-Key': KEY,
      'X-Encoding': ENCODING,
      'X-Job-Id': job.id,
    },
    body: job.data,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status >= 500 || res.status === 429) throw new Error(`server ${res.status}`);
  if (!res.ok) {
    log(`거부됨 (${res.status}) ${body.error || ''} - 전표를 버립니다`);
    return;
  }
  log(`전송 완료 job=${job.id} → ${body.action} ${body.displayNo ? `#${body.displayNo}` : ''} ${body.reason || ''}`);
}

function spool(job) {
  fs.writeFileSync(path.join(SPOOL, `${Date.now()}_${job.id}.bin`), job.data);
  log(`서버 전송 실패 - 스풀 저장 job=${job.id}`);
}

async function handle(data) {
  // jobId: 같은 전표 재전송 시 서버에서 중복 주문 방지
  const job = { id: crypto.createHash('sha1').update(data).update(String(Date.now())).digest('hex').slice(0, 16), data };
  try {
    await send(job);
  } catch (err) {
    log(`전송 오류: ${err.message}`);
    spool(job);
  }
}

function forward(data) {
  if (!FORWARD) return;
  const [host, port = '9100'] = FORWARD.split(':');
  const sock = net.connect(Number(port), host, () => sock.end(data));
  sock.on('error', (e) => log(`프린터 전달 실패(${FORWARD}): ${e.message}`));
}

// 스풀 재전송
setInterval(async () => {
  for (const file of fs.readdirSync(SPOOL).filter((f) => f.endsWith('.bin')).sort()) {
    const full = path.join(SPOOL, file);
    try {
      await send({ id: file.split('_')[1].replace('.bin', ''), data: fs.readFileSync(full) });
      fs.unlinkSync(full);
    } catch {
      break; // 서버가 아직 불가 - 다음 주기에 재시도
    }
  }
}, 15000);

const server = net.createServer((sock) => {
  let chunks = [];
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    if (!chunks.length) return;
    const data = Buffer.concat(chunks);
    chunks = [];
    forward(data);
    handle(data);
  };
  sock.on('data', (c) => {
    chunks.push(c);
    clearTimeout(timer);
    timer = setTimeout(flush, IDLE_MS);
  });
  sock.on('end', flush);
  sock.on('error', (e) => log(`POS 연결 오류: ${e.message}`));
});

server.listen(PORT, () => log(`MPS printer agent: :${PORT} → ${SERVER}${FORWARD ? ` (+ 프린터 ${FORWARD})` : ''}`));
