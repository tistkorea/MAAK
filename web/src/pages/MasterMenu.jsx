// 가맹본부 마스터 메뉴 · 표준 레시피 · 표준 조리시간 (본부: 편집 / 하위 조직: 조회)
import { useState } from 'react';
import { patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Field, Modal, toast, toastError, useForm } from '../components/ui.jsx';
import { STATION_TYPES, won } from '../format.js';

const typeLabel = Object.fromEntries(STATION_TYPES);

export default function MasterMenu() {
  const { user, can } = useAuth();
  const { data: orgs } = useApi(user.role === 'developer' ? '/orgs' : null);
  const hqs = (orgs || []).filter((o) => o.type === 'hq');
  const [hqId, setHqId] = useState('');
  const effectiveHq = user.role === 'developer' ? (hqId || hqs[0]?.id) : null;
  const path = user.role === 'developer' ? (effectiveHq ? `/menus?hqId=${effectiveHq}` : null) : '/menus';
  const { data, error, reload } = useApi(path);
  const [edit, setEdit] = useState(null);
  const [catName, setCatName] = useState('');
  const editable = can('menu:master');

  const addCategory = async () => {
    try { await post('/menus/categories', { hqId: data.hq.id, name: catName, sortOrder: data.categories.length }); setCatName(''); reload(); } catch (e) { toastError(e); }
  };
  const catOf = (id) => data?.categories.find((c) => c.id === id)?.name || '미분류';

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>마스터 메뉴 · 레시피 {data && <span className="small muted">· {data.hq.name}</span>}</h1>
        <div className="spacer" />
        {user.role === 'developer' && (
          <select className="input" style={{ width: 'auto' }} value={effectiveHq || ''} onChange={(e) => setHqId(Number(e.target.value))}>
            {hqs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        {editable && data && <button className="btn primary" onClick={() => setEdit({})}>메뉴 추가</button>}
      </div>
      <p className="muted small">본부가 정한 <b>조리 파트</b>, <b>표준 조리시간</b>, <b>표준 레시피</b>가 모든 가맹점 KDS에 그대로 적용되어 매장 간 음식 품질을 일정하게 유지합니다. <b>프린터 출력명</b>에 POS 전표의 약칭을 등록하면 자동 매칭됩니다.</p>
      <ErrorBox error={error} />
      {editable && data && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="input" style={{ width: 200 }} placeholder="새 분류 이름" value={catName} onChange={(e) => setCatName(e.target.value)} />
          <button className="btn" disabled={!catName} onClick={addCategory}>분류 추가</button>
          <span className="small muted">분류: {data.categories.map((c) => c.name).join(' · ')}</span>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>분류</th><th>코드</th><th>메뉴</th><th>조리 파트</th><th>기준시간</th><th>가격</th><th>레시피</th><th /></tr></thead>
          <tbody>
            {data?.items.map((m) => (
              <tr key={m.id} className={m.active ? '' : 'off'}>
                <td className="small">{catOf(m.category_id)}</td>
                <td className="small">{m.code}</td>
                <td><b>{m.name}</b>{m.aliases?.length > 0 && <div className="small muted">출력명: {m.aliases.join(', ')}</div>}</td>
                <td>{typeLabel[m.station_type] || m.station_type}</td>
                <td>{m.min_minutes ? `${m.min_minutes}~` : ''}{m.target_minutes}분</td>
                <td>{won(m.price)}</td>
                <td className="small">{m.recipe?.length ? `${m.recipe.length}단계` : '-'}</td>
                <td><button className="btn sm" onClick={() => setEdit(m)}>{editable ? '수정' : '보기'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && data && (
        <MenuForm item={edit} hqId={data.hq.id} categories={data.categories} readOnly={!editable}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      )}
    </div>
  );
}

function MenuForm({ item, hqId, categories, readOnly, onClose, onSaved }) {
  const { values, bind } = useForm({
    code: item.code || '', name: item.name || '', categoryId: item.category_id ?? categories[0]?.id ?? '',
    aliases: (item.aliases || []).join(', '), price: item.price ?? 0, stationType: item.station_type || 'main',
    targetMinutes: item.target_minutes ?? 10, minMinutes: item.min_minutes ?? '', recipe: (item.recipe || []).join('\n'),
    allergens: (item.allergens || []).join(', '), description: item.description || '', active: item.active ?? true,
  });
  const list = (s) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    const body = {
      code: values.code, name: values.name, categoryId: values.categoryId ? Number(values.categoryId) : null,
      aliases: list(values.aliases), price: Number(values.price) || 0, stationType: values.stationType,
      targetMinutes: Number(values.targetMinutes) || 10, minMinutes: values.minMinutes === '' ? null : Number(values.minMinutes), recipe: values.recipe.split('\n').map((x) => x.trim()).filter(Boolean),
      allergens: list(values.allergens), description: values.description || null, active: values.active,
    };
    try {
      if (item.id) await patch(`/menus/items/${item.id}`, body);
      else await post('/menus/items', { ...body, hqId });
      toast('저장되었습니다 · 전 가맹점에 적용');
      onSaved();
    } catch (e) { toastError(e); }
  };
  return (
    <Modal wide title={item.id ? `${item.name}` : '메뉴 추가'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>닫기</button>{!readOnly && <button className="btn primary" onClick={save}>저장</button>}</>}>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          <Field label="POS 상품코드"><input className="input" {...bind('code')} /></Field>
          <Field label="메뉴명"><input className="input" {...bind('name')} /></Field>
          <Field label="분류">
            <select className="input" {...bind('categoryId')}>
              <option value="">미분류</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="프린터 출력명(약칭, 쉼표 구분)"><input className="input" {...bind('aliases')} /></Field>
          <Field label="조리 파트">
            <select className="input" {...bind('stationType')}>
              {STATION_TYPES.filter(([k]) => k !== 'expo').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="기준 조리시간 하한(분) — 이보다 빠르면 '과속' 표시"><input className="input" type="number" min="1" {...bind('minMinutes')} /></Field>
          <Field label="표준(상한) 조리시간(분)"><input className="input" type="number" min="1" {...bind('targetMinutes')} /></Field>
          <Field label="권장 판매가"><input className="input" type="number" {...bind('price')} /></Field>
          <Field label="알레르기 유발 성분(쉼표 구분)"><input className="input" {...bind('allergens')} /></Field>
        </div>
        <Field label="표준 레시피 (한 줄에 한 단계 — KDS '레시피' 버튼으로 표시)">
          <textarea className="input" style={{ minHeight: 140 }} {...bind('recipe')} />
        </Field>
        <Field label="설명"><input className="input" {...bind('description')} /></Field>
        <label className="check"><input type="checkbox" {...bind('active', 'checkbox')} /> 판매 메뉴로 사용</label>
      </fieldset>
    </Modal>
  );
}
