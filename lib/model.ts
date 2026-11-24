// Token launch radar: a category-relative valuation model over one sealed snapshot.
//
// The question this board answers: if a protocol that records no token issued one today, and the
// market priced it the way it already prices that protocol's category peers, what would the token
// be worth — and what should a reader do on the protocol now to be counted if it ever does?
//
// The model uses only the snapshot's own figures, in four steps, and states every one of them:
//
//   1. Peer multiple. Every protocol whose token already trades gives a market-cap / TVL ratio.
//      A pre-token protocol inherits the median ratio of its own category (shrunk toward the
//      global median when the category has few trading peers, clamped to a sane band). A DEX is
//      priced like DEXes, a lending market like lending markets — never one flat multiple.
//      Single ratios are winsorized before any median: one miscategorised token trading at
//      hundreds of times its TVL must not price a whole category.
//   2. Momentum. The 7-day TVL change tilts the peer value: a protocol the market is flowing
//      into is worth more than the same TVL standing still. The tilt is bounded both ways.
//   3. Track record. A protocol that has held real TVL for years with no token is a stronger
//      launch candidate than one listed last month; the factor rises with age, with
//      diminishing returns, and never below a floor for the young.
//   4. Product honesty. A wrapped, staked or bridged product of an asset that already trades
//      (the snapshot's own telltales: its name and category) is not a launch waiting to happen —
//      its value accrues to the parent asset. Such rows are flagged and cut to a twentieth
//      (x0.05): at a fifth, the largest bridges still held ranks 4-9 on raw TVL alone, above
//      genuine launch candidates a twentieth of their size; at a twentieth they stay visible
//      and flagged without crowding the top of the board.
//
// No protocol name is ever special-cased: the same functions score every row, and the dashboard
// shows each row's full breakdown so a reader can disagree with any factor.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the argument. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  peer_shrink_k: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  track_floor: number;
  track_span: number;
  track_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  product_factor: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.03,
  multiple_cap: 2.0,
  peer_shrink_k: 8,
  momentum_weight: 0.3,
  momentum_floor_pct: -60,
  momentum_cap_pct: 120,
  track_floor: 0.72,
  track_span: 0.28,
  track_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.015,
  chain_max_extra: 8,
  product_factor: 0.05,
};

export const MODEL_VERSION = 'peerdesk-3';

/** How many already-trading protocols the dashboard's trading view carries, by market cap. */
export const LIVE_ROWS = 30;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank at all: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Restaking', 'Restaked BTC']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token record is a wrapped, staked or bridged product of an asset that already
 * trades, judged from the record's own name and category — the same telltales the snapshot's
 * watchlist rule uses. Liquid staking protocols are NOT products by this test: a staking
 * protocol with no token of its own is a launch candidate like any other.
 */
export function isProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The peer table the model prices from: one shrunk, clamped multiple per category, plus the global. */
export interface PeerTable {
  global_multiple: number;
  by_category: Map<string, { multiple: number; peers: number }>;
}

/** Build the peer table from every protocol whose token already trades with a recorded market cap. */
export function peerTable(snapshot: Snapshot): PeerTable {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, 0.02, MODEL.multiple_cap);
    ratios.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const global = median(ratios) ?? 0.2;
  const by_category = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of byCategory) {
    const med = median(list)!;
    const n = list.length;
    // Shrink a thin category toward the global median with weight n / (n + k): one peer is a
    // ninth of the word, eight peers are half, and a deep category mostly speaks for itself.
    // The stronger shrink matters: several categories have a single trading peer whose ratio
    // sits at the winsorized cap, and at k = 4 that one outlier priced the whole top of the
    // board (Risk Curators at 0.57x against a 0.21x global median); at k = 8 it still leads
    // its category, but no longer dictates it.
    const w = n / (n + MODEL.peer_shrink_k);
    const shrunk = w * med + (1 - w) * global;
    by_category.set(category, { multiple: clamp(shrunk, MODEL.multiple_floor, MODEL.multiple_cap), peers: n });
  }
  return { global_multiple: clamp(global, MODEL.multiple_floor, MODEL.multiple_cap), by_category };
}

/** One protocol's full scoring breakdown, so the dashboard can show its work. */
export interface ScoreParts {
  peer_multiple: number;
  peer_count: number;
  momentum_factor: number;
  track_factor: number;
  footprint_factor: number;
  product: boolean;
  product_factor: number;
  age_days: number | null;
  implied: number;
  readiness: number;
  confidence: 'high' | 'medium' | 'low';
}

/** Score one pre-token protocol against the peer table. Pure: same snapshot, same score. */
export function score(p: SnapshotProtocol, asOf: string, peers: PeerTable): ScoreParts {
  const cat = p.category !== null ? peers.by_category.get(p.category) : undefined;
  const peerMultiple = cat?.multiple ?? peers.global_multiple;
  const peerCount = cat?.peers ?? 0;

  const growthPct = clamp(finite(p.change_7d, 0), MODEL.momentum_floor_pct, MODEL.momentum_cap_pct);
  const momentum = 1 + (growthPct / 100) * MODEL.momentum_weight;

  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const track = MODEL.track_floor + MODEL.track_span * Math.sqrt(clamp(ageForModel, 0, MODEL.track_days) / MODEL.track_days);

  const footprint = 1 + MODEL.chain_step * Math.min(Math.max(p.chains.length - 1, 0), MODEL.chain_max_extra);

  const product = isProduct(p);
  const productFactor = product ? MODEL.product_factor : 1;

  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * momentum * track * footprint * productFactor));

  // Readiness is a separate, display-only judgement: how completely this row looks like a launch
  // candidate (scale, staying power, inflow, reach). It never moves the rank.
  const tvlScore = clamp(Math.log10(Math.max(p.tvl_usd, 1)) / 10, 0, 1);
  const ageScore = clamp(ageForModel / MODEL.track_days, 0, 1);
  const flowScore = clamp((growthPct + 20) / 60, 0, 1);
  const reachScore = clamp(p.chains.length / 6, 0, 1);
  let readiness = Math.round(100 * (0.4 * tvlScore + 0.25 * ageScore + 0.2 * flowScore + 0.15 * reachScore));
  if (product) readiness = Math.round(readiness * 0.4);

  const known = (p.change_7d !== null ? 1 : 0) + (p.listed_at !== null ? 1 : 0) + (p.category !== null ? 1 : 0) + (peerCount >= 4 ? 1 : 0);
  const confidence = known >= 4 ? 'high' : known >= 2 ? 'medium' : 'low';

  return {
    peer_multiple: round4(peerMultiple),
    peer_count: peerCount,
    momentum_factor: round4(momentum),
    track_factor: round4(track),
    footprint_factor: round4(footprint),
    product,
    product_factor: productFactor,
    age_days: age,
    implied,
    readiness,
    confidence,
  };
}

/** One row of board.json: the ranked board's row, with the model breakdown attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  product: boolean;
  age_days: number | null;
  implied_value_usd: number;
  readiness: number;
  confidence: 'high' | 'medium' | 'low';
  model: {
    peer_multiple: number;
    peer_count: number;
    momentum_factor: number;
    track_factor: number;
    footprint_factor: number;
    product_factor: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow extends BoardRow {
  farm_plan: { action: string; cost: string; time: string }[];
}

/** A protocol whose token already trades: shown at the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the trading set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  product_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Gas for one on-chain action, by the chain the action happens on. */
function gasFor(chain: string): { label: string; usd: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { label: 'Ethereum mainnet gas', usd: 12 };
  if (c === 'solana') return { label: 'Solana fees', usd: 1 };
  if (['base', 'arbitrum', 'optimism', 'zksync era', 'linea', 'scroll', 'blast', 'mode', 'mantle'].includes(c)) return { label: `${chain} gas`, usd: 1 };
  if (['bsc', 'polygon', 'avalanche', 'gnosis', 'fantom', 'sonic', 'berachain'].includes(c)) return { label: `${chain} gas`, usd: 2 };
  return { label: `${chain} gas`, usd: 3 };
}

/** Capital for one farm position, scaled to the protocol's own size so the plan stays realistic. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long a position should run, from the protocol's age: the younger it is, the longer the window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** A deterministic 0..n-1 pick from the slug, so phrasing varies by protocol but never between runs. */
function pick(slug: string, n: number): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % n;
}

interface Playbook {
  open: (name: string, chain: string, capital: number) => string;
  deepen: (name: string, chain: string, capital: number) => string;
  weekly: (name: string, chain: string) => string;
}

/** The category playbooks: what farming this kind of protocol actually looks like. */
function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      open: (n, ch, cap) => `Supply $${cap} of USDC as collateral in ${n}'s main market on ${ch}; do not borrow against it yet, the supply side is what most points programs count first.`,
      deepen: (n, ch, cap) => `Borrow $${Math.round(cap / 3)} of a second stablecoin against the position and re-supply it once, then stop: one loop deepens the activity record without stacking liquidation risk.`,
      weekly: (n) => `Rebalance the ${n} position back to its starting collateral ratio and claim any points or rewards the app shows for the week.`,
    };
  }
  if (c.includes('dex') || c.includes('perps') || c.includes('derivative')) {
    return {
      open: (n, ch, cap) => `Trade $${cap} of volume through ${n}'s main market on ${ch} in two or three natural swaps, then leave a small resting position so the wallet reads as a user, not a passer-by.`,
      deepen: (n, ch, cap) => `Add $${Math.round(cap / 2)} of liquidity to ${n}'s busiest pool on ${ch} and keep it inside the active range.`,
      weekly: (n) => `Make one ordinary trade on ${n} each week and re-centre the liquidity position if it drifted out of range.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      open: (n, ch, cap) => `Bridge $${cap} of USDC from Ethereum to ${ch} through ${n}, and spend the bridged funds in one app on the far side instead of bridging straight back.`,
      deepen: (n, ch, cap) => `Bridge a second, smaller amount ($${Math.round(cap / 2)}) on a different day and route, so the record shows repeated real use rather than one pass.`,
      weekly: (n, ch) => `Use the ${n} route for one small transfer a week whenever you move funds to ${ch} anyway.`,
    };
  }
  if (c.includes('staking') || c.includes('restak') || c.includes('curator') || c.includes('allocator')) {
    return {
      open: (n, ch, cap) => `Deposit $${cap} into ${n}'s main vault or staking position on ${ch} and keep the receipt shares in the same wallet.`,
      deepen: (n, ch, cap) => `Split a second $${Math.round(cap / 2)} across one more ${n} vault or curator on ${ch}, so the record covers more than a single strategy.`,
      weekly: (n) => `Check the ${n} vault's allocation page weekly and claim any points the dashboard shows; leave the principal untouched.`,
    };
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('yield')) {
    return {
      open: (n, ch, cap) => `Mint or deposit $${cap} of ${n}'s yield-bearing asset on ${ch} and hold it in the farming wallet.`,
      deepen: (n, ch, cap) => `Put $${Math.round(cap / 2)} of the minted asset to work as collateral or liquidity in one integrated app on ${ch}, keeping the position easy to unwind.`,
      weekly: (n) => `Confirm the ${n} position still shows in the app weekly and claim any distribution or points it posts.`,
    };
  }
  return {
    open: (n, ch, cap) => `Deposit $${cap} of USDC into ${n} on ${ch} through its main app flow and keep the position open.`,
    deepen: (n, ch, cap) => `Use one more of ${n}'s core features with $${Math.round(cap / 2)} — a second market, pool or vault — so the wallet's record is not a single click.`,
    weekly: (n) => `Make one qualifying action on ${n} each week — a deposit, a claim or a vote — and keep the balance from sitting idle.`,
  };
}

/** One farm step as the board carries it: the action, then its cost and time, 20..600 characters. */
export interface FarmStepParts {
  action: string;
  cost: string;
  time: string;
}

export function stepText(step: FarmStepParts): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the app weekly.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps from wallet hygiene to exit criteria, each with a cost and
 * a time, built from the protocol's own record — category playbook, first two chains, TVL-scaled
 * capital, age-scaled holding window. Products of already-trading assets get an honest plan:
 * farm the parent ecosystem, and expect any reward to arrive as the parent's, not a new token's.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, product: boolean): FarmStepParts[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p);
  const variant = pick(p.slug, 2);
  const steps: FarmStepParts[] = [
    {
      action:
        variant === 0
          ? `Set up one fresh wallet for ${p.name} alone and fund it from your main wallet in a single transfer; keep the seed phrase offline and never reuse this wallet for unrelated airdrop hunting.`
          : `Create a dedicated wallet for ${p.name}, fund it once from your main wallet, and store its seed phrase offline; a clean, consistent history is what most eligibility snapshots reward.`,
      cost: `about $${gas.usd} of ${gas.label} to fund and make the first move`,
      time: '10 minutes',
    },
    {
      action: book.open(p.name, chain, capital),
      cost: `$${capital} of capital plus about $${gas.usd} of ${gas.label}`,
      time: '20 minutes to set up',
    },
    {
      action: book.deepen(p.name, chain, capital),
      cost: `about $${Math.round(capital / 2)} more capital and $${Math.max(1, Math.round(gas.usd / 2))} of gas`,
      time: '15 minutes',
    },
  ];
  if (secondChain !== null) {
    const gas2 = gasFor(secondChain);
    steps.push({
      action: `Repeat a small version of the position on ${secondChain}, ${p.name}'s second chain: $${Math.round(capital / 2)} is enough for the wallet to count as multi-chain activity if a future program weights it.`,
      cost: `about $${Math.round(capital / 2)} of capital and $${gas2.usd} of ${gas2.label}`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      action: book.weekly(p.name, chain),
      cost: `about $${Math.max(1, Math.round(gas.usd / 4))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      action: `Hold the ${p.name} position for at least ${hold} days without emptying the wallet, so the activity spans more than one eligibility snapshot; partial top-ups count for more than one large deposit.`,
      cost: `the $${capital} stays deployed; opportunity cost only`,
      time: `${hold} days`,
    },
    {
      action: `Check eligibility only inside ${p.name}'s own app or its verified announcement channel; never connect the wallet to a claim link from search results or social replies, and never pay a fee to "unlock" a reward.`,
      cost: 'nothing to check; any claim fee demand is a scam signal',
      time: '5 minutes a week',
    },
    {
      action: product
        ? `${p.name} is a wrapped or bridged product of an asset that already trades, so treat any reward as the parent ecosystem's: unwind when the parent's program ends or when the position's yield no longer covers its gas for a month.`
        : `Log every ${p.name} transaction with dates in a farm sheet, and unwind within a week of any token or points announcement: after an announcement the cheap qualifying window usually closes fast.`,
      cost: 'nothing but the log; unwinding costs one more round of gas',
      time: '5 minutes a week, 20 minutes to unwind',
    },
  );
  return steps.slice(0, 8);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerTable(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, s: score(p, snapshot.as_of, peers) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(p.slug),
    product: s.product,
    age_days: s.age_days,
    implied_value_usd: s.implied,
    readiness: s.readiness,
    confidence: s.confidence,
    model: {
      peer_multiple: s.peer_multiple,
      peer_count: s.peer_count,
      momentum_factor: s.momentum_factor,
      track_factor: s.track_factor,
      footprint_factor: s.footprint_factor,
      product_factor: s.product_factor,
    },
    farm_steps: farmPlan(p, s.age_days, s.product).map(stepText),
  }));
}

/** The already-trading protocols, by market cap, at the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = peerTable(snapshot);
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    global_multiple: peers.global_multiple,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    product_size: board.filter((r) => r.product).length,
    live_size: live.length,
    rows: board.map((r) => {
      const proto = snapshot.protocols.find((p) => p.slug === r.slug)!;
      return { ...r, farm_plan: farmPlan(proto, r.age_days, r.product) };
    }),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
