// Gauge dashboard charts: plain SVG built with DOM calls (no external scripts), hover/focus tooltips.
const NS = 'http://www.w3.org/2000/svg';
const RED = '#FE1B04';
const short = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function svgEl(svg, tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  svg.append(n);
  return n;
}
function frame(W, H, label) {
  const wrap = document.createElement('div');
  wrap.className = 'chart ichart';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const tip = document.createElement('div');
  tip.className = 'ctip';
  tip.hidden = true;
  wrap.append(svg, tip);
  const show = (x, y, html) => {
    tip.replaceChildren(...html);
    tip.hidden = false;
    const r = svg.getBoundingClientRect();
    tip.style.left = Math.min(Math.max((x / W) * r.width, 60), r.width - 60) + 'px';
    tip.style.top = (y / H) * r.height + 'px';
  };
  const hide = () => { tip.hidden = true; };
  svg.addEventListener('mouseleave', hide);
  return { wrap, svg, show, hide };
}
function line(text, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = text;
  return d;
}

// Multi-series trend (0–100 %). series: [{key, name, color}], items oldest→newest [{at, ...}].
export function trendChart(items, series) {
  const W = 640, H = 240, L = 36, R = 14, T = 14, B = 30;
  const pts = items.filter((p) => series.some((s) => p[s.key] != null));
  const { wrap, svg, show, hide } = frame(W, H, 'Scores over time');
  if (!pts.length) return wrap;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  for (const v of [0, 25, 50, 75, 100]) {
    svgEl(svg, 'line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis' });
    svgEl(svg, 'text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'lbl' }, v + '%');
  }
  svgEl(svg, 'text', { x: L, y: H - 8, class: 'lbl' }, short(pts[0].at));
  if (pts.length > 1) svgEl(svg, 'text', { x: W - R, y: H - 8, 'text-anchor': 'end', class: 'lbl' }, short(pts[pts.length - 1].at));
  for (const s of series) {
    const p = pts.map((d, i) => (d[s.key] == null ? null : [x(i), y(d[s.key])])).filter(Boolean);
    if (s.area && p.length > 1) {
      svgEl(svg, 'path', { d: `M${p[0][0]},${y(0)} L` + p.map((q) => q.join(',')).join(' L') + ` L${p[p.length - 1][0]},${y(0)} Z`, fill: s.color, opacity: 0.08 });
    }
    if (p.length > 1) svgEl(svg, 'polyline', { points: p.map((q) => q.join(',')).join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.5, 'stroke-linejoin': 'round', 'stroke-dasharray': s.dash || '' });
    for (const q of p) svgEl(svg, 'circle', { cx: q[0], cy: q[1], r: 3.5, fill: '#fff', stroke: s.color, 'stroke-width': 2 });
  }
  // hover columns
  const cursor = svgEl(svg, 'line', { x1: 0, x2: 0, y1: T, y2: H - B, stroke: '#9ca3af', 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const colW = pts.length === 1 ? W - L - R : (W - L - R) / (pts.length - 1);
  pts.forEach((d, i) => {
    const hit = svgEl(svg, 'rect', { x: x(i) - colW / 2, y: T, width: colW, height: H - T - B, fill: 'transparent', tabindex: 0 });
    const on = () => {
      cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i)); cursor.setAttribute('visibility', 'visible');
      show(x(i), T, [line(new Date(d.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 'ct-h'),
        ...series.filter((s) => d[s.key] != null).map((s) => { const r = line(`${s.name}: ${d[s.key]}%`); r.style.borderLeft = `3px solid ${s.color}`; return r; })]);
    };
    hit.addEventListener('mouseenter', on);
    hit.addEventListener('focus', on);
    hit.addEventListener('blur', () => { hide(); cursor.setAttribute('visibility', 'hidden'); });
  });
  svg.addEventListener('mouseleave', () => cursor.setAttribute('visibility', 'hidden'));
  return wrap;
}

// Vertical bars with a target line. rows newest→oldest [{end, count, from}].
export function barChart(rows, target) {
  const W = 640, H = 220, L = 36, R = 14, T = 16, B = 30;
  const data = [...rows].reverse();
  const { wrap, svg, show } = frame(W, H, 'Invitations sent per week');
  if (!data.length) return wrap;
  const top = Math.max(target, ...data.map((r) => r.count)) * 1.1;
  const y = (v) => T + ((top - v) * (H - T - B)) / top;
  const slot = (W - L - R) / data.length;
  const bw = Math.min(56, slot * 0.6);
  for (const v of [0, Math.round(top / 2)]) {
    svgEl(svg, 'line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis' });
    svgEl(svg, 'text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'lbl' }, String(v));
  }
  data.forEach((r, i) => {
    const cx = L + slot * i + slot / 2;
    const good = r.count >= target * 0.7;
    const bar = svgEl(svg, 'rect', { x: cx - bw / 2, y: y(r.count), width: bw, height: Math.max(1, y(0) - y(r.count)), rx: 5,
      fill: good ? '#1a9e55' : RED, opacity: r.from === 'next' ? 0.55 : 1, tabindex: 0, class: 'bar' });
    svgEl(svg, 'text', { x: cx, y: y(r.count) - 5, 'text-anchor': 'middle', class: 'val' }, String(r.count));
    svgEl(svg, 'text', { x: cx, y: H - 10, 'text-anchor': 'middle', class: 'lbl' }, short(r.end));
    const on = () => show(cx, y(r.count), [line('7 days to ' + short(r.end), 'ct-h'), line(`${r.count} invitations still pending`),
      line(`${Math.round((r.count / target) * 100)}% of the ${target}/week pace`), ...(r.pending != null ? [line(`${r.pending} pending in total`)] : []),
      ...(r.from === 'next' ? [line('Read at the following sync', 'ct-m')] : [])]);
    bar.addEventListener('mouseenter', on);
    bar.addEventListener('focus', on);
  });
  svgEl(svg, 'line', { x1: L, x2: W - R, y1: y(target), y2: y(target), stroke: '#111827', 'stroke-dasharray': '5 4', 'stroke-width': 1.2 });
  svgEl(svg, 'text', { x: L + 4, y: y(target) - 5, class: 'lbl' }, `Pace ${target}/week`);
  return wrap;
}

// Lever change since the previous test: [{name, value, prev}] → horizontal diverging list.
export function leverDelta(rows) {
  const box = document.createElement('div');
  box.className = 'ldelta';
  for (const r of rows) {
    const d = r.value - r.prev;
    const row = document.createElement('div');
    row.className = 'ldrow';
    const name = line(r.name, 'ldname');
    const track = document.createElement('div');
    track.className = 'ldtrack';
    const prev = document.createElement('i');
    prev.className = 'prev';
    prev.style.width = r.prev + '%';
    const now = document.createElement('b');
    now.className = d >= 0 ? 'up' : 'down';
    now.style.width = r.value + '%';
    track.append(now, prev);
    track.title = `${r.name}: ${r.prev}% → ${r.value}%`;
    row.append(name, track, line((d > 0 ? '+' : '') + d, 'lddiff ' + (d > 0 ? 'up' : d < 0 ? 'down' : '')));
    box.append(row);
  }
  return box;
}
