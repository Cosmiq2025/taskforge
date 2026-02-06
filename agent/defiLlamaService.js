/**
 * DeFiLlama Service — Live DeFi Data (Free, no API key)
 *
 * Endpoints used:
 *   GET https://api.llama.fi/protocols             → all protocols
 *   GET https://api.llama.fi/protocol/{slug}        → single protocol detail
 *   GET https://api.llama.fi/v2/chains              → chain TVL rankings
 *   GET https://api.llama.fi/v2/historicalChainTvl/{chain} → chain TVL history
 *   GET https://yields.llama.fi/pools               → yield / APY data
 *   GET https://api.llama.fi/overview/dexs           → DEX volumes
 *   GET https://stablecoins.llama.fi/stablecoins     → stablecoin data
 */

const https = require('https');

class DefiLlamaService {
    constructor() {
        this.baseUrl     = 'https://api.llama.fi';
        this.yieldsUrl   = 'https://yields.llama.fi';
        this.stableUrl   = 'https://stablecoins.llama.fi';
        this._cache      = new Map();
        console.log('📊 DefiLlama service ready (free API, no key)');
    }

    // ─── HTTP ────────────────────────────────────

    fetchJSON(url, timeoutMs = 15_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { req.destroy(); reject(new Error(`Timeout: ${url}`)); }, timeoutMs);
            const req = https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
                if (res.statusCode !== 200) { clearTimeout(timer); res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
                let buf = '';
                res.on('data', c => { buf += c; });
                res.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(buf)); } catch { reject(new Error('Bad JSON')); } });
            });
            req.on('error', e => { clearTimeout(timer); reject(e); });
        });
    }

    async cached(key, ttlMs, fn) {
        const e = this._cache.get(key);
        if (e && Date.now() - e.t < ttlMs) return e.v;
        const v = await fn();
        this._cache.set(key, { v, t: Date.now() });
        if (this._cache.size > 300) { const oldest = this._cache.keys().next().value; this._cache.delete(oldest); }
        return v;
    }

    // ─── Protocols ───────────────────────────────

    /** All protocols (cached 10 min — big list) */
    async getAllProtocols() {
        return this.cached('protocols', 600_000, () => this.fetchJSON(`${this.baseUrl}/protocols`));
    }

    /**
     * Search / filter protocols
     * @param {object} opts - { query, chain, category, limit }
     */
    async searchProtocols({ query = '', chain, category, limit = 15 } = {}) {
        try {
            const all = await this.getAllProtocols();
            if (!Array.isArray(all)) return { ok: false, error: 'Failed to fetch protocols' };

            const q = query.toLowerCase();
            const terms = q.split(/\s+/).filter(Boolean);

            let list = all;

            if (chain) {
                const cl = chain.toLowerCase();
                list = list.filter(p =>
                    (p.chain || '').toLowerCase() === cl ||
                    (p.chains || []).some(c => c.toLowerCase() === cl)
                );
            }
            if (category) {
                const catL = category.toLowerCase();
                list = list.filter(p => (p.category || '').toLowerCase().includes(catL));
            }
            if (terms.length) {
                list = list.filter(p => {
                    const hay = `${p.name} ${p.slug} ${p.symbol} ${p.category}`.toLowerCase();
                    return terms.every(t => hay.includes(t));
                });
            }

            list.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));

            return {
                ok: true,
                filters: { query: query || null, chain: chain || 'all', category: category || 'all' },
                total: list.length,
                protocols: list.slice(0, limit).map(p => ({
                    name:       p.name,
                    slug:       p.slug,
                    symbol:     p.symbol || '—',
                    category:   p.category || 'Unknown',
                    tvl:        p.tvl || 0,
                    tvlFmt:     this.fmtUSD(p.tvl),
                    change_1d:  p.change_1d != null ? `${p.change_1d > 0 ? '+' : ''}${p.change_1d.toFixed(2)}%` : '—',
                    change_7d:  p.change_7d != null ? `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(2)}%` : '—',
                    change_1m:  p.change_1m != null ? `${p.change_1m > 0 ? '+' : ''}${p.change_1m.toFixed(2)}%` : '—',
                    chains:     p.chains || [],
                    mcap:       p.mcap ? this.fmtUSD(p.mcap) : '—',
                    url:        p.url || null,
                    description: (p.description || '').substring(0, 200),
                    audits:     p.audits || 0,
                })),
                ts: new Date().toISOString()
            };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /** Detailed data for one protocol (by slug) */
    async getProtocolDetail(slug) {
        try {
            const clean = String(slug).toLowerCase().replace(/[^a-z0-9\-_.]/g, '').slice(0, 100);
            const data = await this.cached(`proto_${clean}`, 120_000, () =>
                this.fetchJSON(`${this.baseUrl}/protocol/${clean}`)
            );

            // Chain TVL breakdown
            const chainTvls = {};
            if (data.chainTvls) {
                for (const [ch, tvlArr] of Object.entries(data.chainTvls)) {
                    if (tvlArr.tvl?.length) chainTvls[ch] = tvlArr.tvl[tvlArr.tvl.length - 1].totalLiquidityUSD || 0;
                }
            }

            // Recent TVL history (30 days)
            const history = (data.tvl || []).slice(-30).map(p => ({
                date: new Date(p.date * 1000).toISOString().split('T')[0],
                tvl:  p.totalLiquidityUSD || 0
            }));

            const currentTvl = history.length ? history[history.length - 1].tvl : 0;

            return {
                ok: true,
                protocol: {
                    name:        data.name,
                    symbol:      data.symbol || '—',
                    description: data.description || '',
                    category:    data.category || 'Unknown',
                    tvl:         currentTvl,
                    tvlFmt:      this.fmtUSD(currentTvl),
                    chains:      data.chains || [],
                    chainTvls,
                    url:         data.url || null,
                    twitter:     data.twitter || null,
                    audits:      data.audits || 0,
                    mcap:        data.mcap ? this.fmtUSD(data.mcap) : '—',
                    history
                },
                ts: new Date().toISOString()
            };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // ─── Chains ──────────────────────────────────

    /** All chains ranked by TVL */
    async getChainsTVL() {
        return this.cached('chains', 300_000, async () => {
            try {
                const data = await this.fetchJSON(`${this.baseUrl}/v2/chains`);
                const chains = data
                    .filter(c => c.tvl > 0)
                    .sort((a, b) => b.tvl - a.tvl)
                    .map((c, i) => ({
                        rank: i + 1, name: c.name,
                        tvl: c.tvl, tvlFmt: this.fmtUSD(c.tvl),
                        token: c.tokenSymbol || '—'
                    }));
                return { ok: true, count: chains.length, chains, ts: new Date().toISOString() };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    }

    /** Single chain TVL + 7d/30d change */
    async getChainTVL(chainName) {
        try {
            const data = await this.cached(`chain_${chainName}`, 300_000, () =>
                this.fetchJSON(`${this.baseUrl}/v2/historicalChainTvl/${chainName}`)
            );
            if (!data?.length) return { ok: false, error: `No data for "${chainName}"` };

            const latest   = data[data.length - 1];
            const week     = data.length > 7  ? data[data.length - 8]  : data[0];
            const month    = data.length > 30 ? data[data.length - 31] : data[0];
            const pct = (a, b) => b > 0 ? ((a - b) / b * 100).toFixed(2) : '0';

            // Also get rank
            const allChains = await this.getChainsTVL();
            const rank = allChains.ok
                ? (allChains.chains.findIndex(c => c.name.toLowerCase() === chainName.toLowerCase()) + 1) || '—'
                : '—';

            return {
                ok: true,
                chain: chainName,
                tvl: latest.tvl, tvlFmt: this.fmtUSD(latest.tvl),
                rank,
                change_7d:  `${parseFloat(pct(latest.tvl, week.tvl)) > 0 ? '+' : ''}${pct(latest.tvl, week.tvl)}%`,
                change_30d: `${parseFloat(pct(latest.tvl, month.tvl)) > 0 ? '+' : ''}${pct(latest.tvl, month.tvl)}%`,
                history: data.slice(-30).map(p => ({ date: new Date(p.date * 1000).toISOString().split('T')[0], tvl: p.tvl })),
                ts: new Date().toISOString()
            };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // ─── Yields ──────────────────────────────────

    /** Yield pools, filterable by chain / project / stablecoin */
    async getYields({ chain, project, stableOnly = false, limit = 15 } = {}) {
        try {
            const data = await this.cached('yields', 180_000, () =>
                this.fetchJSON(`${this.yieldsUrl}/pools`)
            );
            if (!data?.data?.length) return { ok: false, error: 'No yield data' };

            let pools = data.data;
            if (chain)      pools = pools.filter(p => (p.chain || '').toLowerCase() === chain.toLowerCase());
            if (project)    pools = pools.filter(p => (p.project || '').toLowerCase().includes(project.toLowerCase()));
            if (stableOnly) pools = pools.filter(p => p.stablecoin === true);

            // Only pools with meaningful TVL
            pools = pools.filter(p => (p.tvlUsd || 0) > 10_000 && (p.apy || 0) > 0);
            pools.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));

            return {
                ok: true,
                filters: { chain: chain || 'all', project: project || 'all', stableOnly },
                total: pools.length,
                pools: pools.slice(0, limit).map(p => ({
                    project:   p.project,
                    symbol:    p.symbol,
                    chain:     p.chain,
                    tvl:       p.tvlUsd || 0,
                    tvlFmt:    this.fmtUSD(p.tvlUsd),
                    apy:       p.apy  != null ? `${p.apy.toFixed(2)}%` : '—',
                    apyBase:   p.apyBase != null ? `${p.apyBase.toFixed(2)}%` : '—',
                    apyReward: p.apyReward != null ? `${p.apyReward.toFixed(2)}%` : '—',
                    stable:    p.stablecoin || false,
                    ilRisk:    p.ilRisk || 'unknown',
                })),
                ts: new Date().toISOString()
            };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /** Top yields by APY on a chain */
    async getTopYieldsByChain(chain, limit = 15) {
        try {
            const data = await this.cached('yields', 180_000, () =>
                this.fetchJSON(`${this.yieldsUrl}/pools`)
            );
            let pools = (data?.data || [])
                .filter(p => (p.chain || '').toLowerCase() === chain.toLowerCase() && p.apy > 0 && (p.tvlUsd || 0) > 10_000);
            pools.sort((a, b) => (b.apy || 0) - (a.apy || 0));
            return {
                ok: true, chain,
                pools: pools.slice(0, limit).map(p => ({
                    project: p.project, symbol: p.symbol,
                    tvlFmt: this.fmtUSD(p.tvlUsd), apy: `${p.apy.toFixed(2)}%`,
                    stable: p.stablecoin || false
                })),
                ts: new Date().toISOString()
            };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // ─── DEX Volumes ─────────────────────────────

    async getDexVolumes() {
        return this.cached('dex_vol', 300_000, async () => {
            try {
                const data = await this.fetchJSON(`${this.baseUrl}/overview/dexs`);
                const dexes = (data.protocols || [])
                    .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
                    .slice(0, 20)
                    .map((d, i) => ({
                        rank: i + 1, name: d.name,
                        vol24h: this.fmtUSD(d.total24h),
                        change_1d: d.change_1d ? `${d.change_1d > 0 ? '+' : ''}${d.change_1d.toFixed(1)}%` : '—',
                        chains: d.chains || []
                    }));
                return {
                    ok: true, totalVol24h: this.fmtUSD(data.total24h),
                    dexes, ts: new Date().toISOString()
                };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    }

    // ─── Stablecoins ─────────────────────────────

    async getStablecoins() {
        return this.cached('stables', 300_000, async () => {
            try {
                const data = await this.fetchJSON(`${this.stableUrl}/stablecoins?includePrices=true`);
                const stables = (data.peggedAssets || [])
                    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
                    .slice(0, 15)
                    .map((s, i) => ({
                        rank: i + 1, name: s.name, symbol: s.symbol,
                        mcap: this.fmtUSD(s.circulating?.peggedUSD),
                        price: s.price != null ? `$${parseFloat(s.price).toFixed(4)}` : '—',
                        chains: (s.chains || []).length
                    }));
                return { ok: true, stablecoins: stables, ts: new Date().toISOString() };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    }

    // ─── Compound queries (used by AI agent) ─────

    /** Full ecosystem overview for a chain */
    async chainOverview(chain) {
        const [tvl, protos, yields] = await Promise.all([
            this.getChainTVL(chain),
            this.searchProtocols({ chain, limit: 10 }),
            this.getTopYieldsByChain(chain, 10),
        ]);
        return { ok: true, chain, tvl, protocols: protos, yields, ts: new Date().toISOString() };
    }

    /** Compare chains side-by-side */
    async compareChains(names) {
        const allChains = await this.getChainsTVL();
        const results = {};
        for (const name of names) {
            const row = allChains.ok ? allChains.chains.find(c => c.name.toLowerCase() === name.toLowerCase()) : null;
            const protos = await this.searchProtocols({ chain: name, limit: 5 });
            results[name] = {
                tvl: row ? row.tvlFmt : '—', tvlRaw: row ? row.tvl : 0, rank: row ? row.rank : '—',
                topProtocols: protos.ok ? protos.protocols.map(p => `${p.name} (${p.tvlFmt})`) : []
            };
        }
        return { ok: true, comparison: results, ts: new Date().toISOString() };
    }

    // ─── Helpers ─────────────────────────────────

    fmtUSD(v) {
        if (!v || isNaN(v)) return '$0';
        if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
        if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
        if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
        return `$${v.toFixed(2)}`;
    }
}

module.exports = DefiLlamaService;
