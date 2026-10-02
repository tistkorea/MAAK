export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const badRequest = (msg, detail) => new HttpError(400, msg, detail);
export const forbidden = (msg = '권한이 없습니다') => new HttpError(403, msg);
export const notFound = (msg = '대상을 찾을 수 없습니다') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

// zod 스키마로 요청 본문 검증
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw badRequest('입력값이 올바르지 않습니다', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return r.data;
}
