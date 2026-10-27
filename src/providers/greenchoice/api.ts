// Mijn Greenchoice's own JSON API, as its "Verbruik" page uses it. Runs on mijn.greenchoice.nl with the
// visitor's session cookie. An hourly request only returns hours for a single day (a longer range comes
// back per day), so a year is 365 small requests, a few at a time.
import type { HourRow } from '../../bookmarklet/protocol.ts';
import { addDays, type DateRange } from '../../bookmarklet/runtime.ts';

interface Cost {
  kind: string;
  quantity: number;
}

interface Period {
  consumedOn: string;
  products?: { type: string; costs?: Cost[]; totals?: { feedInQuantity?: number } }[];
}

export interface ConsumptionResponse {
  interval: string;
  periods?: Period[];
}

export interface AgreementIds {
  customerId: string;
  agreementId: string;
}

const CONCURRENCY = 4;
const RETRIES = 3;

const round = (v: number) => Math.round(v * 1000) / 1000;

// Grid use is every "Consumption" register (normal and low tariff); feed-in is reported as negative.
export function parseConsumptions(json: ConsumptionResponse): HourRow[] {
  return (json.periods ?? []).flatMap((p): HourRow[] => {
    const power = p.products?.find((x) => x.type === 'Electricity');
    if (!power) return [];
    const costs = power.costs ?? [];
    const importKwh = costs.filter((c) => c.kind === 'Consumption').reduce((sum, c) => sum + c.quantity, 0);
    const feedIn = power.totals?.feedInQuantity
      ?? costs.filter((c) => c.kind === 'FeedIn').reduce((sum, c) => sum + c.quantity, 0);
    return [[p.consumedOn, round(importKwh), round(Math.abs(feedIn))]];
  });
}

const IDS_IN_URL = /\/api\/v\d+\/customers\/(\d+)\/agreements\/(\d+)\//;

export function idsFromUrls(urls: string[]): AgreementIds | null {
  for (const url of urls) {
    const m = url.match(IDS_IN_URL);
    if (m) return { customerId: m[1], agreementId: m[2] };
  }
  return null;
}

// Looks for the first customer and agreement number anywhere in the account response.
export function idsFromAccount(account: unknown): AgreementIds | null {
  let customerId: string | null = null, agreementId: string | null = null;
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    for (const [k, v] of Object.entries(node)) {
      if ((typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v))) {
        if (!customerId && /^customer(id|number)$/i.test(k)) customerId = String(v);
        if (!agreementId && /^agreement(id|number)$/i.test(k)) agreementId = String(v);
      } else visit(v, depth + 1);
    }
  };
  visit(account, 0);
  return customerId && agreementId ? { customerId, agreementId } : null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new Error('You are not logged in to Mijn Greenchoice. Log in and click the bookmark again.');
  if (!res.ok) throw new Error(`Greenchoice answered ${res.status} for ${new URL(url, location.href).pathname}.`);
  return res.json() as Promise<T>;
}

export async function findAgreement(): Promise<AgreementIds> {
  const seen = idsFromUrls(performance.getEntriesByType('resource').map((e) => e.name));
  if (seen) return seen;
  const fromAccount = idsFromAccount(await getJson('/api/v2/account'));
  if (fromAccount) return fromAccount;
  throw new Error('Couldn\'t find your contract. Open the "Verbruik" page in Mijn Greenchoice and click the bookmark again.');
}

export async function fetchHours(range: DateRange, onProgress: (done: number, total: number) => void): Promise<HourRow[]> {
  const { customerId, agreementId } = await findAgreement();
  const base = `/api/v3/customers/${customerId}/agreements/${agreementId}/consumptions?interval=Hour`;
  const days: string[] = [];
  for (let d = range.start; d < range.end; d = addDays(d, 1)) days.push(d);

  const byDay = new Map<string, HourRow[]>();
  let done = 0;
  const fetchDay = async (day: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        byDay.set(day, parseConsumptions(await getJson<ConsumptionResponse>(`${base}&start=${day}&end=${addDays(day, 1)}`)));
        break;
      } catch (err) {
        if (attempt >= RETRIES || (err instanceof Error && err.message.includes('not logged in'))) throw err;
        await new Promise((r) => setTimeout(r, 750 * attempt));
      }
    }
    onProgress(++done, days.length);
  };

  const queue = [...days];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let day = queue.shift(); day; day = queue.shift()) await fetchDay(day);
  }));
  return days.flatMap((d) => byDay.get(d) ?? []);
}
