// Lever lines shared by /report and /app. Every line is a link to the LinkedIn page the figure
// comes from, so the user can check it and act on it. Levers that were not read are listed too,
// with the page to open, instead of silently disappearing.
const tone = (v) => (v >= 70 ? 'good' : v >= 45 ? 'warn' : 'bad');
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function link(href, cls) {
  const a = el('a', cls);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function leverRow(l) {
  const row = link(l.source || 'https://www.linkedin.com/', 'lever lever-link');
  row.title = 'Open this on LinkedIn';
  const what = el('div');
  what.append(el('b', null, l.name), el('span', null, l.detail || `Target ${l.target}%`));
  if (l.value != null && l.value < l.target && l.move) what.append(el('span', 'fix', `To improve: ${l.move} ↗`));
  const track = el('div', 'track');
  if (l.value != null) {
    const f = el('div', 'fill ' + tone(l.value));
    f.style.width = l.value + '%';
    track.append(f);
  }
  row.append(what, track, el('span', 'val num', l.value == null ? '—' : l.value + '%'));
  return row;
}

export function notReadRow(l) {
  const row = link(l.source || 'https://www.linkedin.com/', 'lever lever-link notread');
  const what = el('div');
  what.append(el('b', null, l.name), el('span', null, 'Not read this time — open the page on LinkedIn to check it, then run Grade me again ↗'));
  row.append(what, el('div', 'track'), el('span', 'val num', '—'));
  return row;
}

export function leverList(levers, { showMissing = true } = {}) {
  const box = el('div');
  for (const [group, title] of [['fill', 'What you fill'], ['work', 'What you work']]) {
    const items = levers.filter((l) => l.group === group && (l.value != null || (showMissing && l.id !== 'pageVisitors')));
    if (!items.length) continue;
    box.append(el('p', 'group', title));
    for (const l of items) box.append(l.value == null ? notReadRow(l) : leverRow(l));
  }
  return box;
}

export function moveCard(mv) {
  const d = mv.source ? link(mv.source, 'move move-link') : el('div', 'move');
  d.append(el('span', 'gain num', `+${mv.gain} pts`), el('b', null, mv.title), el('span', null, mv.why));
  if (mv.source) d.append(el('span', 'go', 'Do it on LinkedIn ↗'));
  return d;
}
