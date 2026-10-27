// The start screen: a solar household's day in two chapters, noon and night. The headline's two prices
// come from the same 2027 tariff the results use, so they can't drift apart.
import type { Tariff } from './simulate.ts';

const ct = (eur: number) => `${Math.round(eur * 100)} ct`;

// Each chapter's parts rise in as it enters; without script (or with reduced motion) they simply show.
function bindEntrances() {
  document.documentElement.classList.add('js');
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        seen.unobserve(e.target);
      }
    }
  }, { threshold: 0.15 });
  for (const ch of document.querySelectorAll('.start .ch')) seen.observe(ch);
}

export function initStart(tariff: Tariff) {
  document.getElementById('hero-noon')!.textContent = `${ct(tariff.netExportEurKwh)} at noon,`;
  document.getElementById('hero-night')!.textContent = `${ct(tariff.importEurKwh)} tonight`;
  bindEntrances();
}
