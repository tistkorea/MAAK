import { useEffect, useState } from 'react';

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="field">{label}{children}</label>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error">{error.message || String(error)}</div>;
}

export function Empty({ children = '데이터가 없습니다' }) {
  return <div className="empty">{children}</div>;
}

export function Kpi({ label, value, hint, tone }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

// 간단 토스트
const listeners = new Set();
export function toast(message, type = 'info') {
  for (const l of listeners) l({ id: Math.random(), message, type });
}
export const toastError = (e) => toast(e?.message || String(e), 'err');

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const l = (t) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 3500);
    };
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.type === 'err' ? 'err' : ''}`}>{t.message}</div>)}
    </div>
  );
}

// 폼 상태 헬퍼
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (key, type = 'text') => {
    if (type === 'checkbox') return { checked: Boolean(values[key]), onChange: (e) => setValues((v) => ({ ...v, [key]: e.target.checked })) };
    return {
      value: values[key] ?? '',
      onChange: (e) => setValues((v) => ({ ...v, [key]: e.target.value })),
    };
  };
  return { values, setValues, bind };
}
