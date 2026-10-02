import { ITEM_STATUS, ORDER_TYPE, elapsedSec, mmss, urgency } from '../format.js';

// KDS 티켓 카드: 주문 1건 중 해당 스테이션 품목
export default function TicketCard({ order, items, now, onItem, onRecipe, showStation, head, footer, progress }) {
  const target = Math.max(...items.map((i) => i.target_minutes), order.target_minutes || 1);
  const elapsed = elapsedSec(order.created_at, now);
  const level = head?.level || urgency(elapsed, target);

  return (
    <article className={`ticket ${order.rush ? 'rush' : ''}`}>
      <div className={`ticket-head ${level}`}>
        <span className="no">#{order.display_no}</span>
        {order.table_no && <span>T{order.table_no}</span>}
        {order.rush && <span className="badge late">긴급</span>}
        <span className="timer" title={`표준 ${target}분`}>{head?.timer ?? mmss(elapsed)}</span>
      </div>
      <div className="ticket-meta">
        <span>{ORDER_TYPE[order.order_type]}</span>
        <span>{new Date(order.created_at).toLocaleTimeString('ko-KR', { hour12: false })}</span>
        <span>표준 {target}분</span>
        {order.source === 'printer' && <span>🖨 프린터</span>}
        {order.source === 'pos' && <span>POS</span>}
      </div>
      {progress != null && <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>}
      <div className="ticket-items">
        {items.map((it) => (
          <div
            key={it.id}
            className={`titem ${it.status}`}
            style={showStation ? { borderLeftColor: it.station_color || '#374151' } : undefined}
            onClick={() => onItem?.(it)}
            role={onItem ? 'button' : undefined}
            tabIndex={onItem ? 0 : undefined}
            onKeyDown={(e) => e.key === 'Enter' && onItem?.(it)}
          >
            <span className="q">{it.qty}</span>
            <div>
              <div className="n">{it.name}</div>
              {it.options && <div className="opt">└ {it.options}</div>}
              {showStation && <div className="small" style={{ color: '#9ca3af' }}>{it.station_name || '미지정'}</div>}
            </div>
            <span className="st">{ITEM_STATUS[it.status]}</span>
            {it.menu_item_id && onRecipe && (
              <button className="recipe-btn" onClick={(e) => { e.stopPropagation(); onRecipe(it); }} title="레시피">레시피</button>
            )}
          </div>
        ))}
      </div>
      {order.memo && <div className="ticket-memo">📝 {order.memo}</div>}
      {footer && <div className="ticket-foot">{footer}</div>}
    </article>
  );
}
