// Small dependency-free SVG charts. Colors come from CSS custom properties so both themes work.

import type { CompareRow } from './simulate.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface Series<K extends string> {
  key: K;
  name: string;
  color: string;
}

export interface BalanceLine {
  name: string;
  color: string;
  dashed?: boolean;
  points: { year: number; value: number }[];
}

type Attrs = Record<string, string | number>;
type TipLine = [color: string | null, name: string, value: string];

export const fmt = {
  eur: (v: number) => (v < 0 ? '−€' : '€') + Math.round(Math.abs(v)).toLocaleString('en-US'),
  signedEur: (v: number) => (v < 0 ? '−€' : '+€') + Math.round(Math.abs(v)).toLocaleString('en-US'),
  eurCents: (v: number) => (v < -0.005 ? '−€' : '€') + Math.abs(v).toFixed(2),
  day: (d: string) => new Date(d + 'T00:00:00Z').toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  kwh: (v: number) => Math.round(v).toLocaleString('en-US'),
  years: (v: number | null) => (v !== null && Number.isFinite(v) && v > 0 ? v.toFixed(1) : '—'),
  payback: (v: number | null, lifetime: number) => (v !== null && Number.isFinite(v) && v > 0 && v <= lifetime
    ? `pays for itself in ${v.toFixed(1)} years`
    : `doesn't pay for itself within ${lifetime} years`),
  month: (m: string, withYear?: boolean) => {
    const d = new Date(m + '-01T00:00:00Z');
    const name = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return withYear ? `${name} ’${String(d.getUTCFullYear()).slice(2)}` : name;
  },
  monthLong: (m: string) => new Date(m + '-01T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  hour: (h: number) => String(h).padStart(2, '0') + ':00',
  watts: (kw: number) => `${Math.round(kw * 1000).toLocaleString('en-US')} W`,
};

function el(name: string, attrs: Attrs = {}, parent?: Element): SVGElement {
  const node = document.createElementNS(SVG_NS, name) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) {
    // CSS variables only resolve reliably as style properties, not as presentation attributes.
    if ((k === 'fill' || k === 'stroke') && String(v).startsWith('var(')) node.style[k] = String(v);
    else node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function linear([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const s = (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  return Object.assign(s, { invert: (p: number) => d0 + ((p - r0) / (r1 - r0 || 1)) * (d1 - d0) });
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.999; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;
function textWidth(text: string): number {
  measureCtx.font = `12px ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(text).width;
}

function prepare(box: HTMLElement, height: number): { svg: SVGElement; width: number } | null {
  const width = box.clientWidth;
  // A hidden or not-yet-laid-out box has no width; the ResizeObserver redraws once it does.
  if (width < 160) return null;
  let svg: SVGElement | null = box.querySelector('svg');
  if (!svg) svg = el('svg', { role: 'img' }, box);
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  return { svg, width };
}

function label(parent: Element, x: number, y: number, text: string, attrs: Attrs = {}) {
  const t = el('text', { x, y, class: 'chart-label', 'dominant-baseline': 'middle', ...attrs }, parent);
  t.textContent = text;
  return t;
}

export function showTip(box: HTMLElement, x: number, y: number, title: string, lines: TipLine[]) {
  let tip = box.querySelector<HTMLElement>('.tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    box.appendChild(tip);
  }
  tip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'tip-head';
  head.textContent = title;
  tip.appendChild(head);
  for (const [color, name, value] of lines) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    if (color) {
      const sw = document.createElement('i');
      sw.style.background = color;
      row.appendChild(sw);
    }
    row.append(name ? `${name}: ${value}` : value);
    tip.appendChild(row);
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = Math.max(0, Math.min(box.clientWidth - w, x + 12)) + 'px';
  tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
}

export function hideTip(box: HTMLElement) {
  const tip = box.querySelector<HTMLElement>('.tip');
  if (tip) tip.hidden = true;
}

function pointer(ev: MouseEvent, node: Element): [number, number] {
  const r = node.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
}

// Horizontal bars: lifetime result per battery size, diverging from zero.
export function sizeChart(box: HTMLElement, rows: CompareRow[], lifetimeYears: number, brand: string, activeUnits: number) {
  const rowH = 48;
  const height = rows.length * rowH + 8;
  const prepared = prepare(box, height);
  if (!prepared) return;
  const { svg, width } = prepared;
  svg.setAttribute('aria-label', `Result after ${lifetimeYears} years for each battery size`);
  const names = rows.map((r) => `${r.units} × ${brand} · ${r.capacityKwh.toFixed(1)} kWh`);
  // On narrow cards the payback sentence doesn't fit beside the bar; it stays in the tooltip.
  const narrow = box.clientWidth < 560;
  const ends = rows.map((r) => fmt.signedEur(r.lifetimeResultEur!) + (narrow ? '' : ` · ${fmt.payback(r.paybackYears, lifetimeYears)}`));
  const left = Math.max(...names.map(textWidth)) + 16;
  const right = Math.max(...ends.map(textWidth)) + 12;
  const lo = Math.min(0, ...rows.map((r) => r.lifetimeResultEur!));
  const hi = Math.max(0, ...rows.map((r) => r.lifetimeResultEur!));
  const x = linear([lo, hi], [left, Math.max(left + 40, width - right)]);

  rows.forEach((r, i) => {
    const g = el('g', { transform: `translate(0, ${i * rowH + 4})`, class: 'hit' }, svg);
    label(g, 0, rowH / 2 - 4, names[i], { class: r.units === activeUnits ? 'chart-label strong' : 'chart-label' });
    const result = r.lifetimeResultEur!;
    const x0 = x(0), x1 = x(result);
    el('rect', {
      x: Math.min(x0, x1), y: rowH / 2 - 14, height: 20, rx: 4,
      width: Math.max(2, Math.abs(x1 - x0)),
      fill: result < 0 ? 'var(--negative)' : 'var(--data)',
    }, g);
    label(g, Math.max(x0, x1) + 8, rowH / 2 - 4, ends[i]);
    el('rect', { x: 0, y: 0, width, height: rowH, fill: 'transparent' }, g);
    g.addEventListener('mousemove', (ev) => {
      const [mx, my] = pointer(ev as MouseEvent, box);
      showTip(box, mx, my, names[i], [
        [null, 'Saves per year', fmt.eur(r.savingEur)],
        [null, 'Price', fmt.eur(r.costEur)],
        [null, 'Paid back', fmt.payback(r.paybackYears, lifetimeYears)],
        [null, `Profit after ${lifetimeYears} years`, fmt.signedEur(result)],
        [null, 'Times fully charged per year', fmt.kwh(r.cycles)],
      ]);
    });
    g.addEventListener('mouseleave', () => hideTip(box));
  });
  el('line', { x1: x(0), x2: x(0), y1: 0, y2: height, class: 'axis' }, svg);
}

function yAxis(svg: SVGElement, ticks: number[], y: (v: number) => number, left: number, width: number, format: (v: number) => string) {
  for (const t of ticks) {
    el('line', { x1: left, x2: width, y1: y(t), y2: y(t), class: 'grid' }, svg);
    label(svg, left - 8, y(t), format(t), { 'text-anchor': 'end' });
  }
}

// Grouped bars per month.
export function monthlyChart<K extends string>(box: HTMLElement, rows: ({ month: string } & Record<K, number>)[], series: Series<K>[]) {
  const height = 240, top = 8, bottom = 24;
  const prepared = prepare(box, height);
  if (!prepared) return;
  const { svg, width } = prepared;
  svg.setAttribute('aria-label', 'Solar exported and battery use per month');
  const max = Math.max(...rows.flatMap((r) => series.map((s) => r[s.key])));
  const ticks = niceTicks(max);
  const y = linear([0, ticks[ticks.length - 1]], [height - bottom, top]);
  const left = Math.max(...ticks.map((t) => textWidth(fmt.kwh(t)))) + 12;
  yAxis(svg, ticks, y, left, width, fmt.kwh);

  const band = (width - left) / rows.length;
  const inner = band * 0.78;
  const barW = inner / series.length - 1;

  // Month labels: the first and last carry the year, so they're wider. Keep a label only if it
  // clears the previous one, and always keep the last by dropping whatever it would overlap.
  const placed: { text: string; cx: number; x0: number; x1: number }[] = [];
  rows.forEach((r, i) => {
    const edge = i === 0 || i === rows.length - 1;
    const text = fmt.month(r.month, edge);
    const cx = left + i * band + band / 2;
    const w = textWidth(text);
    const item = { text, cx, x0: cx - w / 2, x1: cx + w / 2 };
    if (i === rows.length - 1) {
      while (placed.length > 1 && placed[placed.length - 1].x1 + 6 > item.x0) placed.pop();
      placed.push(item);
    } else if (!placed.length || placed[placed.length - 1].x1 + 6 <= item.x0) placed.push(item);
  });
  for (const p of placed) label(svg, p.cx, height - 8, p.text, { 'text-anchor': 'middle' });

  rows.forEach((r, i) => {
    const gx = left + i * band + (band - inner) / 2;
    const g = el('g', { transform: `translate(${gx},0)` }, svg);
    series.forEach((s, j) => {
      const h = Math.max(0, y(0) - y(r[s.key]));
      el('rect', { x: j * (barW + 1), y: y(0) - h, width: Math.max(1, barW), height: h, rx: Math.max(0, Math.min(3, barW / 2)), fill: s.color }, g);
    });
    const hit = el('rect', { x: left + i * band, y: top, width: band, height: height - bottom - top, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (ev) => {
      const [mx, my] = pointer(ev as MouseEvent, box);
      showTip(box, mx, my, fmt.monthLong(r.month), series.map((s) => [s.color, s.name, fmt.kwh(r[s.key]) + ' kWh']));
    });
    hit.addEventListener('mouseleave', () => hideTip(box));
  });
}

// One thin bar per day plus a 7-day average line.
export function dailyChart(box: HTMLElement, rows: { date: string; savingEur: number; fromBatteryKwh: number }[], color: string) {
  const height = 220, top = 8, bottom = 24;
  const prepared = prepare(box, height);
  if (!prepared) return;
  const { svg, width } = prepared;
  svg.setAttribute('aria-label', 'Battery saving in euros for each day of the year');
  const max = Math.max(...rows.map((r) => r.savingEur));
  const min = Math.min(0, ...rows.map((r) => r.savingEur));
  const ticks = niceTicks(max);
  const y = linear([min, ticks[ticks.length - 1]], [height - bottom, top]);
  const left = Math.max(...ticks.map((t) => textWidth(fmt.eurCents(t)))) + 12;
  yAxis(svg, ticks, y, left, width, fmt.eurCents);

  const band = (width - left) / rows.length;
  const barW = Math.max(0.6, band - (band > 3 ? 1 : 0));
  const bars = rows.map((r, i) => {
    const y0 = y(0), y1 = y(r.savingEur);
    return el('rect', {
      x: left + i * band, y: Math.min(y0, y1), width: barW, height: Math.max(0.5, Math.abs(y1 - y0)),
      fill: r.savingEur < 0 ? 'var(--negative)' : color, opacity: 0.55,
    }, svg);
  });

  const avg = rows.map((_, i) => {
    const win = rows.slice(Math.max(0, i - 3), i + 4);
    return win.reduce((s, r) => s + r.savingEur, 0) / win.length;
  });
  el('path', {
    d: avg.map((v, i) => `${i ? 'L' : 'M'}${left + i * band + band / 2},${y(v)}`).join(''),
    fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }, svg);

  let lastRight = -Infinity;
  rows.forEach((r, i) => {
    if (!r.date.endsWith('-01')) return;
    const cx = left + i * band;
    const text = fmt.month(r.date.slice(0, 7), r.date.slice(5, 7) === '01');
    const w = textWidth(text);
    if (cx - w / 2 < lastRight + 6 || cx + w / 2 > width) return;
    label(svg, cx, height - 8, text, { 'text-anchor': 'middle' });
    lastRight = cx + w / 2;
  });

  let active: SVGElement | null = null;
  const hit = el('rect', { x: left, y: top, width: width - left, height: height - bottom - top, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', (ev) => {
    const [mx, my] = pointer(ev as MouseEvent, box);
    const i = Math.max(0, Math.min(rows.length - 1, Math.floor((mx - left) / band)));
    if (active) active.setAttribute('opacity', '0.55');
    active = bars[i];
    active.setAttribute('opacity', '1');
    const r = rows[i];
    showTip(box, mx, my, fmt.day(r.date), [
      [null, 'Saved', fmt.eurCents(r.savingEur)],
      [null, 'Power from the battery', r.fromBatteryKwh.toFixed(1) + ' kWh'],
      [null, 'Average that week', fmt.eurCents(avg[i])],
    ]);
  });
  hit.addEventListener('mouseleave', () => {
    if (active) active.setAttribute('opacity', '0.55');
    active = null;
    hideTip(box);
  });
}

// Two lines over the hours of an average day.
export function profileChart<K extends string>(box: HTMLElement, rows: ({ hour: number } & Record<K, number>)[], series: Series<K>[]) {
  const height = 240, top = 8, bottom = 24;
  const prepared = prepare(box, height);
  if (!prepared) return;
  const { svg, width } = prepared;
  svg.setAttribute('aria-label', 'Average grid use and solar export per hour of the day');
  const max = Math.max(...rows.flatMap((r) => series.map((s) => r[s.key])));
  const ticks = niceTicks(max);
  const y = linear([0, ticks[ticks.length - 1]], [height - bottom, top]);
  const format = (t: number) => t.toFixed(1);
  const left = Math.max(...ticks.map((t) => textWidth(format(t)))) + 12;
  yAxis(svg, ticks, y, left, width, format);
  const x = linear([0, 23], [left + 4, width - 8]);

  const hours = width < 420 ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21];
  for (const h of hours) label(svg, x(h), height - 8, fmt.hour(h), { 'text-anchor': 'middle' });

  for (const s of series) {
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.hour)},${y(r[s.key])}`).join('');
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  }

  const rule = el('line', { y1: top, y2: height - bottom, class: 'rule', visibility: 'hidden' }, svg);
  const dots = series.map((s) => el('circle', { r: 4, fill: s.color, visibility: 'hidden' }, svg));
  const hit = el('rect', { x: left, y: top, width: width - left, height: height - bottom - top, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', (ev) => {
    const [mx, my] = pointer(ev as MouseEvent, box);
    const h = Math.max(0, Math.min(23, Math.round(x.invert(mx))));
    const r = rows[h];
    rule.setAttribute('x1', String(x(h)));
    rule.setAttribute('x2', String(x(h)));
    rule.setAttribute('visibility', 'visible');
    series.forEach((s, i) => {
      dots[i].setAttribute('cx', String(x(h)));
      dots[i].setAttribute('cy', String(y(r[s.key])));
      dots[i].setAttribute('visibility', 'visible');
    });
    showTip(box, mx, my, `${fmt.hour(h)}–${fmt.hour(h + 1)}`, series.map((s) => [s.color, s.name, r[s.key].toFixed(2) + ' kWh']));
  });
  hit.addEventListener('mouseleave', () => {
    rule.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    hideTip(box);
  });
}

// Ticks for a range that may start below zero, always including zero.
function rangeTicks(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 0.001; t += step) ticks.push(+t.toFixed(6));
  return ticks;
}

// Running balance per year: starts at minus the price and climbs with each year's saving.
// lines: [{ name, color, dashed, points: [{ year, value }] }]; the first line gets the payback marker.
export function balanceChart(box: HTMLElement, lines: BalanceLine[], paybackYears: number | null) {
  const height = 260, top = 12, bottom = 26;
  const prepared = prepare(box, height);
  if (!prepared) return;
  const { svg, width } = prepared;
  svg.setAttribute('aria-label', 'Running balance of the battery purchase over the years');
  const values = lines.flatMap((l) => l.points.map((p) => p.value));
  const ticks = rangeTicks(Math.min(0, ...values), Math.max(0, ...values));
  const y = linear([ticks[0], ticks[ticks.length - 1]], [height - bottom, top]);
  const left = Math.max(...ticks.map((t) => textWidth(fmt.eur(t)))) + 12;
  const lastYear = lines[0].points[lines[0].points.length - 1].year;
  const x = linear([0, lastYear], [left + 4, width - 12]);

  for (const t of ticks) {
    el('line', { x1: left, x2: width, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid' }, svg);
    label(svg, left - 8, y(t), fmt.eur(t), { 'text-anchor': 'end' });
  }
  const step = lastYear > 10 && width < 520 ? 5 : lastYear > 10 ? 2 : 1;
  for (let yr = 0; yr <= lastYear; yr += step) label(svg, x(yr), height - 8, yr ? `year ${yr}` : 'buy', { 'text-anchor': 'middle' });

  for (const line of [...lines].reverse()) {
    const d = line.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.year)},${y(p.value)}`).join('');
    el('path', {
      d, fill: 'none', stroke: line.color, 'stroke-width': line.dashed ? 1.5 : 2.5,
      'stroke-dasharray': line.dashed ? '5 4' : 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }, svg);
  }

  if (paybackYears !== null && paybackYears <= lastYear) {
    const px = x(paybackYears), py = y(0);
    el('circle', { cx: px, cy: py, r: 5, fill: lines[0].color }, svg);
    const text = `paid back after ${paybackYears.toFixed(1)} years`;
    const w = textWidth(text);
    // The balance climbs left to right, so below-right of the dot stays clear of the line.
    label(svg, Math.min(px + 10, width - w - 4), py + 16, text, { class: 'chart-label strong' });
  }

  const rule = el('line', { y1: top, y2: height - bottom, class: 'rule', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: left, y: top, width: width - left, height: height - bottom - top, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', (ev) => {
    const [mx, my] = pointer(ev as MouseEvent, box);
    const yr = Math.max(0, Math.min(lastYear, Math.round(x.invert(mx))));
    rule.setAttribute('x1', String(x(yr)));
    rule.setAttribute('x2', String(x(yr)));
    rule.setAttribute('visibility', 'visible');
    showTip(box, mx, my, yr ? `After year ${yr}` : 'Day you buy it', lines.map((l) => {
      const p = l.points.find((q) => q.year === yr)!;
      return [l.color, l.name, fmt.signedEur(p.value)] as TipLine;
    }));
  });
  hit.addEventListener('mouseleave', () => {
    rule.setAttribute('visibility', 'hidden');
    hideTip(box);
  });
}
