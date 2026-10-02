// POS → 주방프린터로 출력되는 ESC/POS 데이터를 KDS 주문으로 변환한다.
// 1) ESC/POS 제어 명령 제거  2) CP949(EUC-KR) 디코딩  3) 주방 주문서 텍스트 파싱

const ESC = 0x1b, GS = 0x1d, FS = 0x1c, DLE = 0x10;

// ESC x 다음에 오는 고정 파라미터 바이트 수
const ESC_ARGS = {
  0x20: 1, 0x21: 1, 0x24: 2, 0x25: 1, 0x2d: 1, 0x32: 0, 0x33: 1, 0x3d: 1, 0x3f: 1, 0x40: 0,
  0x44: -1, 0x45: 1, 0x47: 1, 0x4a: 1, 0x4d: 1, 0x52: 1, 0x54: 1, 0x56: 1, 0x5c: 2, 0x61: 1,
  0x63: 2, 0x64: 1, 0x69: 0, 0x6d: 0, 0x70: 3, 0x72: 1, 0x74: 1, 0x7b: 1,
};
const GS_ARGS = {
  0x21: 1, 0x42: 1, 0x48: 1, 0x49: 1, 0x4c: 2, 0x50: 2, 0x57: 2, 0x61: 1, 0x62: 1, 0x66: 1,
  0x68: 1, 0x72: 1, 0x77: 1,
};
const FS_ARGS = { 0x21: 1, 0x26: 0, 0x2d: 1, 0x2e: 0, 0x43: 1, 0x53: 2, 0x57: 1, 0x70: 2 };

export function stripEscPos(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b === ESC) {
      const c = buf[i + 1];
      if (c === 0x2a) { // ESC * m nL nH d1..dk (비트 이미지)
        const m = buf[i + 2]; const n = buf[i + 3] + buf[i + 4] * 256;
        i += 5 + (m === 32 || m === 33 ? n * 3 : n);
      } else if (c === 0x44) { // ESC D n1..nk NUL (탭 위치)
        i += 2; while (i < buf.length && buf[i] !== 0) i++; i++;
      } else {
        i += 2 + (ESC_ARGS[c] ?? 0);
      }
    } else if (b === GS) {
      const c = buf[i + 1];
      if (c === 0x56) { // GS V m [n] (용지 커트)
        const m = buf[i + 2]; i += (m === 65 || m === 66) ? 4 : 3;
      } else if (c === 0x76 && buf[i + 2] === 0x30) { // GS v 0 m xL xH yL yH (래스터 이미지)
        const x = buf[i + 4] + buf[i + 5] * 256; const y = buf[i + 6] + buf[i + 7] * 256;
        i += 8 + x * y;
      } else if (c === 0x28) { // GS ( fn pL pH ... (QR 등)
        i += 5 + buf[i + 3] + buf[i + 4] * 256;
      } else if (c === 0x6b) { // GS k (바코드)
        const m = buf[i + 2];
        if (m <= 6) { i += 3; while (i < buf.length && buf[i] !== 0) i++; i++; } else { i += 4 + buf[i + 3]; }
      } else {
        i += 2 + (GS_ARGS[c] ?? 0);
      }
    } else if (b === FS) {
      i += 2 + (FS_ARGS[buf[i + 1]] ?? 0);
    } else if (b === DLE) {
      i += buf[i + 1] === 0x14 ? 5 : 3;
    } else if (b === 0x0a || b === 0x09 || b >= 0x20) {
      out.push(b); i++;
    } else {
      i++; // CR, NUL 등 기타 제어문자
    }
  }
  return Buffer.from(out);
}

export function decodeTicket(input, encoding = 'euc-kr') {
  const clean = stripEscPos(input);
  try {
    return new TextDecoder(encoding).decode(clean);
  } catch {
    return clean.toString('utf8');
  }
}

const SEPARATOR = /^[-=_*.~─━·#]{3,}$/;
const TABLE_RE = /(?:테이블|TABLE|TBL|좌석)\s*(?:번호|NO\.?)?\s*[:#.]?\s*([A-Za-z0-9가-힣-]+)/i;
const ORDER_NO_RE = /(?:주문\s*번호|주문\s*NO\.?|ORDER\s*(?:NO\.?|#)|영수증\s*번호|대기\s*번호)\s*[:#.]?\s*([A-Za-z0-9-]+)/i;
const MEMO_RE = /^(?:요청\s*사항|요청|메모|비고|MEMO|NOTE)\s*[:：]?\s*(.*)$/i;
const TYPE_HEADER_RE = /^[[(<*\s]*(포장|배달|매장|TAKE\s*-?\s*OUT|TO\s*GO|DELIVERY|DINE\s*IN)(?:\s*주문)?[\])>*\s]*$/i;
const CANCEL_RE = /^[[(<*\s]*(?:주문\s*)?(?:취소|CANCEL)(?:\s*주문)?[\])>*\s]*$/i;
const RUSH_RE = /^[[(<*!\s]*(?:긴급|급|RUSH)[\])>*!\s]*$/i;
// 한글은 \b 단어경계가 동작하지 않으므로 구분자(:)로 판단
const HEADER_SKIP_RE = /^(?:\d{2,4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?$)|^(?:일시|시간|날짜|포스|POS|담당자?|직원|매장명?|주문\s*시간|출력\s*시간)\s*[:：]|^[[(<*\s]*(?:주방\s*주문서|주방|KITCHEN(?:\s*ORDER)?|ORDER|주문서)[\])>*\s]*$/i;
const COLUMN_HEADER_RE = /^(?:메뉴명?|품명|상품명|MENU|ITEM)\s.*(?:수량|QTY)/i;
const OPTION_RE = /^(?:[-+└ㄴ>]|\(|옵션\s*[:：]?)\s*/;
// "김치찌개  2" / "김치찌개 x2" / "김치찌개 2개" / "김치찌개  2  16,000"
const ITEM_RE = /^(.+?)\s+(?:[xX×*]\s*)?(\d{1,3})\s*(?:개|EA|ea)?(?:\s+[\d,]+\s*원?)?$/;
// "2 x 김치찌개"
const ITEM_PREFIX_RE = /^(\d{1,3})\s*[xX×]\s*(.+)$/;

export function parseKitchenTicket(text) {
  const result = {
    tableNo: null, posOrderNo: null, orderType: 'dine_in',
    isCancel: false, rush: false, memo: [], unparsed: [], items: [],
  };
  let current = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const raw = rawLine.replace(/\t/g, '    ').replace(/\s+$/, '');
    const line = raw.trim();
    if (!line || SEPARATOR.test(line)) continue;

    const memo = line.match(MEMO_RE);
    if (memo) { if (memo[1]) result.memo.push(memo[1].trim()); continue; }

    const table = line.match(TABLE_RE);
    const orderNo = line.match(ORDER_NO_RE);
    if (table || orderNo) {
      if (table) result.tableNo = table[1];
      if (orderNo) result.posOrderNo = orderNo[1];
      if (/포장|TAKE\s*-?\s*OUT/i.test(line)) result.orderType = 'takeout';
      if (/배달|DELIVERY/i.test(line)) result.orderType = 'delivery';
      continue;
    }

    const type = line.match(TYPE_HEADER_RE);
    if (type) {
      const t = type[1].toUpperCase();
      if (t === '포장' || t.startsWith('TAKE') || t === 'TO GO') result.orderType = 'takeout';
      else if (t === '배달' || t === 'DELIVERY') result.orderType = 'delivery';
      continue;
    }
    if (CANCEL_RE.test(line)) { result.isCancel = true; continue; }
    if (RUSH_RE.test(line)) { result.rush = true; continue; }
    if (COLUMN_HEADER_RE.test(line) || HEADER_SKIP_RE.test(line)) continue;

    const indented = /^\s{2,}/.test(raw);
    if (current && (OPTION_RE.test(line) || (indented && !ITEM_RE.test(line)))) {
      const opt = line.replace(OPTION_RE, '').replace(/\)$/, '').trim();
      if (opt) current.options = current.options ? `${current.options}, ${opt}` : opt;
      continue;
    }

    let m = line.match(ITEM_RE);
    if (m) {
      current = { name: cleanName(m[1]), qty: Number(m[2]), options: null };
    } else if ((m = line.match(ITEM_PREFIX_RE))) {
      current = { name: cleanName(m[2]), qty: Number(m[1]), options: null };
    } else {
      // 판독 불가 라인은 버리지 않고 주방에 그대로 보여준다
      result.unparsed.push(line);
      continue;
    }
    if (current.qty > 0 && current.name) result.items.push(current);
  }
  return result;
}

function cleanName(name) {
  return name.replace(/^[[(]?\s*(?:추가|NEW|신규)\s*[\])]?\s*/i, '').replace(/^[*•·]+\s*/, '').trim();
}

export function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[\s()[\]{}._\-·*]/g, '');
}
