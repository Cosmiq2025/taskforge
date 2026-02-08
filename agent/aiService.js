/**
 * AI Service v5 — DeFiLlama Integration
 *
 * NEW: Real DeFi data for every relevant job type
 *   • "find defi protocols on Arbitrum"  → live TVL rankings from DeFiLlama
 *   • "best yield opportunities"         → real APY/TVL pool data
 *   • "research Solana ecosystem"        → protocols + yields + TVL + trends
 *   • "compare Ethereum vs Solana"       → live TVL side-by-side
 *   • "analyze wallet 0x…"              → still uses Monad RPC
 *
 * Data flow:
 *   Job description → detect type → fetch real data → format report (+ AI enhancement if OpenAI configured)
 */

const BlockchainService = require('./blockchainService');
const DefiLlamaService  = require('./defiLlamaService');

class AIService {
    constructor(openaiKey, rpcUrl) {
        this.openaiKey  = openaiKey;
        this.hasOpenAI  = this.isValidOpenAIKey(openaiKey);
        this.blockchain = new BlockchainService(rpcUrl);
        this.defi       = new DefiLlamaService();

        if (this.hasOpenAI) {
            const OpenAI = require('openai');
            this.openai = new OpenAI({ apiKey: openaiKey });
            console.log('🤖 AI Service v5: OpenAI + Blockchain + DeFiLlama');
        } else {
            console.log('🤖 AI Service v5: Blockchain + DeFiLlama (no OpenAI)');
        }
    }

    isValidOpenAIKey(k) { return k && typeof k === 'string' && k.startsWith('sk-') && k.length > 20; }

    sanitizeInput(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim().slice(0, 4000);
    }

    // ─────────────────────────────────────────────
    //  ROUTING
    // ─────────────────────────────────────────────

    async processJob(job) {
        console.log(`\n⚙️ Processing job #${job.id}: "${job.description.substring(0, 60)}…"`);
        const d = job.description.toLowerCase();

        try {
            if (this.isWalletAnalysisJob(d))   return await this.handleWalletAnalysis(job);
            if (this.isYieldJob(d))             return await this.handleYieldResearch(job);
            if (this.isDefiSearchJob(d))        return await this.handleDefiSearch(job);
            if (this.isChainResearchJob(d))     return await this.handleChainResearch(job);
            if (this.isComparisonJob(d))        return await this.handleChainComparison(job);
            if (this.isBlockchainDataJob(d))    return await this.handleBlockchainData(job);
            return await this.handleContentJob(job);
        } catch (error) {
            console.error(`   ❌ Job #${job.id} error:`, error.message);
            return this.fmt({ jobId: job.id, type: 'Error Recovery',
                content: `Processing encountered an issue: ${error.message}. The agent attempted best-effort with available data.`,
                completedAt: new Date().toISOString() });
        }
    }

    // ─────────────────────────────────────────────
    //  TYPE DETECTION
    // ─────────────────────────────────────────────

    isWalletAnalysisJob(d) {
        return (d.includes('wallet') || d.includes('address')) &&
               (d.includes('analy') || d.includes('activity') || d.includes('check') || d.includes('inspect'));
    }

    isDefiSearchJob(d) {
        const defi   = ['defi', 'protocol', 'dex', 'lending', 'tvl', 'liquidity', 'amm', 'swap', 'bridge', 'staking'];
        const action = ['find', 'search', 'list', 'top', 'best', 'show', 'discover', 'what are', 'research', 'which'];
        return defi.some(t => d.includes(t)) && action.some(t => d.includes(t));
    }

    isYieldJob(d) {
        return ['yield', 'apy', 'apr', 'farm', 'earning', 'interest rate', 'best return', 'passive income'].some(t => d.includes(t));
    }

    isChainResearchJob(d) {
        const chains   = ['monad', 'ethereum', 'solana', 'avalanche', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'fantom', 'sui', 'aptos'];
        const research = ['ecosystem', 'overview', 'landscape', 'what protocols', 'defi on', 'projects on', 'research'];
        return chains.some(c => d.includes(c)) && research.some(r => d.includes(r)) && !this.isComparisonJob(d);
    }

    isComparisonJob(d) {
        const chains  = ['monad', 'ethereum', 'solana', 'avalanche', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'];
        const compare = ['compare', 'comparison', ' vs ', 'versus', 'against', 'better than'];
        return chains.some(c => d.includes(c)) && compare.some(t => d.includes(t));
    }

    isBlockchainDataJob(d) {
        return d.includes('balance') ||
               (d.includes('transaction') && /0x[a-fA-F0-9]{40}/.test(d)) ||
               d.includes('block number') || d.includes('gas price');
    }

    // ─────────────────────────────────────────────
    //  HANDLER: DeFi Protocol Search
    // ─────────────────────────────────────────────

    async handleDefiSearch(job) {
        console.log('   🔍 DeFi protocol search (DeFiLlama)…');
        const d = job.description.toLowerCase();

        // Extract chain filter
        const chain = this.detectChain(d);

        // Extract category filter
        const catMap = {
            'dex': 'Dexes', 'exchange': 'Dexes', 'swap': 'Dexes',
            'lending': 'Lending', 'borrow': 'Lending', 'loan': 'Lending',
            'bridge': 'Bridge', 'cross-chain': 'Bridge',
            'staking': 'Liquid Staking', 'liquid staking': 'Liquid Staking',
            'derivative': 'Derivatives', 'perp': 'Derivatives', 'perpetual': 'Derivatives',
            'cdp': 'CDP', 'nft': 'NFT',
        };
        let category = null;
        for (const [key, val] of Object.entries(catMap)) { if (d.includes(key)) { category = val; break; } }

        // Extract free-text query (e.g. "find aave" → "aave")
        let query = '';
        const nameMatch = job.description.match(/(?:find|search|about|called|named|protocol)\s+["']?([A-Za-z0-9\s]{2,30})["']?/i);
        if (nameMatch) query = nameMatch[1].trim();

        // Fetch live data
        const res = await this.defi.searchProtocols({ query, chain, category, limit: 15 });

        if (!res.ok) return this.fmt({ jobId: job.id, type: 'DeFi Research', error: res.error });
        if (!res.protocols.length) {
            return this.fmt({ jobId: job.id, type: 'DeFi Research',
                content: `No protocols found (chain: ${chain || 'all'}, category: ${category || 'all'}, query: "${query || 'none'}"). Try broadening your search.`,
                completedAt: new Date().toISOString() });
        }

        // Build report
        let rpt = `# DeFi Protocol Report\n\n`;
        rpt += `**Task:** ${job.description.substring(0, 250)}\n`;
        rpt += `**Filters:** Chain: ${chain || 'All'} · Category: ${category || 'All'} · Query: ${query || '—'}\n`;
        rpt += `**Results:** ${res.protocols.length} of ${res.total} matching protocols\n`;
        rpt += `**Source:** DeFiLlama (live) · ${res.ts.split('T')[0]}\n\n---\n\n`;

        // Rankings table
        rpt += `## Rankings by TVL\n\n`;
        rpt += `| # | Protocol | TVL | Category | 24h | 7d | Chains |\n`;
        rpt += `|---|----------|-----|----------|-----|-----|--------|\n`;
        res.protocols.forEach((p, i) => {
            const ch = p.chains.slice(0, 3).join(', ') + (p.chains.length > 3 ? '…' : '');
            rpt += `| ${i + 1} | **${p.name}** | ${p.tvlFmt} | ${p.category} | ${p.change_1d} | ${p.change_7d} | ${ch} |\n`;
        });

        // Top 5 detail cards
        rpt += `\n## Protocol Details\n\n`;
        for (const p of res.protocols.slice(0, 5)) {
            rpt += `### ${p.name} (${p.symbol})\n`;
            rpt += `- **TVL:** ${p.tvlFmt}${p.mcap !== '—' ? ` · MCap: ${p.mcap}` : ''}\n`;
            rpt += `- **Category:** ${p.category}\n`;
            rpt += `- **Chains:** ${p.chains.join(', ')}\n`;
            rpt += `- **24h / 7d / 30d:** ${p.change_1d} / ${p.change_7d} / ${p.change_1m}\n`;
            if (p.description) rpt += `- ${p.description}${p.description.length >= 200 ? '…' : ''}\n`;
            if (p.audits) rpt += `- **Audits:** ${p.audits}\n`;
            if (p.url) rpt += `- ${p.url}\n`;
            rpt += `\n`;
        }

        // Optional AI analysis
        rpt += await this.aiEnhance(
            `Analyze these live DeFi protocols and give 3-4 paragraphs of insight:\n${res.protocols.slice(0, 10).map(p => `${p.name}: TVL ${p.tvlFmt}, ${p.category}, 24h ${p.change_1d}`).join('\n')}\nChain: ${chain || 'All'}, Category: ${category || 'All'}`,
            'DeFi analyst'
        );

        rpt += `\n---\n*Data: DeFiLlama (live) · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'DeFi Research', content: rpt, source: 'DeFiLlama', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Yield Research
    // ─────────────────────────────────────────────

    async handleYieldResearch(job) {
        console.log('   💰 Yield research (DeFiLlama)…');
        const d = job.description.toLowerCase();
        const chain     = this.detectChain(d);
        const stableOnly = d.includes('stable') || d.includes('safe');

        // Try to detect project name
        let project = null;
        const projMatch = job.description.match(/(?:on|from|in|for)\s+([A-Za-z0-9]+)/i);
        if (projMatch && projMatch[1].length > 2) {
            const candidate = projMatch[1].toLowerCase();
            if (!this.CHAIN_KEYS.includes(candidate)) project = candidate;
        }

        const res = await this.defi.getYields({ chain, project, stableOnly, limit: 20 });
        if (!res.ok) return this.fmt({ jobId: job.id, type: 'Yield Research', error: res.error });

        let rpt = `# Yield & APY Report\n\n`;
        rpt += `**Task:** ${job.description.substring(0, 250)}\n`;
        rpt += `**Filters:** Chain: ${chain || 'All'} · Stablecoin-only: ${stableOnly ? 'Yes' : 'No'} · Project: ${project || 'All'}\n`;
        rpt += `**Results:** ${res.pools.length} pools (of ${res.total} matching)\n`;
        rpt += `**Source:** DeFiLlama Yields (live) · ${res.ts.split('T')[0]}\n\n---\n\n`;

        if (!res.pools.length) {
            rpt += `No pools matched your criteria. Try broadening filters.\n`;
        } else {
            rpt += `## Top Opportunities\n\n`;
            rpt += `| # | Pool | Project | Chain | APY | TVL | Stable |\n`;
            rpt += `|---|------|---------|-------|-----|-----|--------|\n`;
            res.pools.forEach((p, i) => {
                rpt += `| ${i + 1} | ${p.symbol} | ${p.project} | ${p.chain} | **${p.apy}** | ${p.tvlFmt} | ${p.stable ? '✓' : '—'} |\n`;
            });

            rpt += `\n## Top 5 Breakdown\n\n`;
            for (const p of res.pools.slice(0, 5)) {
                rpt += `### ${p.symbol} — ${p.project}\n`;
                rpt += `- **Total APY:** ${p.apy} (Base: ${p.apyBase}, Rewards: ${p.apyReward})\n`;
                rpt += `- **TVL:** ${p.tvlFmt} · **Chain:** ${p.chain}\n`;
                rpt += `- **IL Risk:** ${p.ilRisk}\n\n`;
            }

            rpt += `## ⚠️ Risk Note\n\nAPY figures are live snapshots and change constantly. Higher APY = higher risk. Always check audits, assess impermanent loss, and never invest more than you can afford to lose.\n`;
        }

        rpt += await this.aiEnhance(
            `Analyze these yield pools and advise (2-3 paragraphs):\n${res.pools.slice(0, 10).map(p => `${p.symbol} on ${p.project} (${p.chain}): APY ${p.apy}, TVL ${p.tvlFmt}, Stable: ${p.stable}`).join('\n')}`,
            'DeFi yield strategist'
        );

        rpt += `\n---\n*Data: DeFiLlama Yields (live) · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'Yield Research', content: rpt, source: 'DeFiLlama', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Chain Ecosystem Research
    // ─────────────────────────────────────────────

    async handleChainResearch(job) {
        console.log('   🌐 Chain ecosystem research (DeFiLlama)…');
        const chain = this.detectChain(job.description.toLowerCase());
        if (!chain) {
            return this.fmt({ jobId: job.id, type: 'Chain Research',
                content: 'Could not identify which chain to research. Mention a chain name (Ethereum, Solana, Arbitrum, Monad…).', completedAt: new Date().toISOString() });
        }

        const overview = await this.defi.chainOverview(chain);

        let rpt = `# ${chain} Ecosystem Report\n\n`;
        rpt += `**Source:** DeFiLlama (live) · ${overview.ts.split('T')[0]}\n\n---\n\n`;

        // Chain TVL
        rpt += `## Chain Overview\n\n`;
        if (overview.tvl.ok) {
            rpt += `| Metric | Value |\n|--------|-------|\n`;
            rpt += `| **Total TVL** | ${overview.tvl.tvlFmt} |\n`;
            rpt += `| **Rank** | #${overview.tvl.rank} |\n`;
            rpt += `| **7d Change** | ${overview.tvl.change_7d} |\n`;
            rpt += `| **30d Change** | ${overview.tvl.change_30d} |\n\n`;
        } else {
            rpt += `TVL data not yet available for ${chain} on DeFiLlama.\n\n`;
        }

        // Top protocols
        if (overview.protocols.ok && overview.protocols.protocols.length) {
            rpt += `## Top Protocols on ${chain}\n\n`;
            rpt += `| # | Protocol | TVL | Category | 24h |\n`;
            rpt += `|---|----------|-----|----------|-----|\n`;
            overview.protocols.protocols.forEach((p, i) => {
                rpt += `| ${i + 1} | **${p.name}** | ${p.tvlFmt} | ${p.category} | ${p.change_1d} |\n`;
            });

            // Category breakdown
            const cats = {};
            overview.protocols.protocols.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
            rpt += `\n### Category Distribution\n`;
            Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => {
                rpt += `- **${cat}:** ${n} protocol${n > 1 ? 's' : ''}\n`;
            });
            rpt += `\n`;
        } else {
            rpt += `## Protocols\n\nNo protocols indexed for ${chain} yet.\n\n`;
        }

        // Top yields
        if (overview.yields.ok && overview.yields.pools.length) {
            rpt += `## Top Yields on ${chain}\n\n`;
            rpt += `| Pool | Project | APY | TVL |\n`;
            rpt += `|------|---------|-----|-----|\n`;
            overview.yields.pools.forEach(p => {
                rpt += `| ${p.symbol} | ${p.project} | ${p.apy} | ${p.tvlFmt} |\n`;
            });
            rpt += `\n`;
        }

        // AI analysis
        rpt += await this.aiEnhance(
            `Analyze ${chain} ecosystem using live data:\nTVL: ${overview.tvl.ok ? overview.tvl.tvlFmt : 'N/A'} (Rank #${overview.tvl.rank || '?'})\nTop protocols: ${overview.protocols.ok ? overview.protocols.protocols.slice(0, 8).map(p => `${p.name} (${p.tvlFmt}, ${p.category})`).join(', ') : 'none'}\nProvide ecosystem maturity, opportunities, and risks.`,
            'blockchain ecosystem analyst'
        );

        rpt += `\n---\n*Data: DeFiLlama (live) · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'Chain Research', content: rpt, source: 'DeFiLlama', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Chain Comparison (now with live TVL)
    // ─────────────────────────────────────────────

    async handleChainComparison(job) {
        console.log('   ⚖️ Chain comparison (DeFiLlama + RPC)…');
        const d = job.description.toLowerCase();

        // Detect mentioned chains
        const mentioned = [];
        for (const [key, val] of Object.entries(this.CHAIN_MAP)) { if (d.includes(key)) mentioned.push(val); }
        if (mentioned.length < 2) { mentioned.length = 0; mentioned.push('Ethereum', 'Solana', 'Arbitrum', 'Base', 'Monad'); }

        // Fetch live TVL + top protocols for each chain
        const liveComparison = await this.defi.compareChains(mentioned);
        const staticComparison = await this.blockchain.getChainComparison();
        const liveNetwork = await this.blockchain.getNetworkInfo();

        let rpt = `# Blockchain Comparison\n\n`;
        rpt += `**Chains:** ${mentioned.join(' vs ')}\n`;
        rpt += `**Live Monad Block:** #${liveNetwork.blockNumber?.toLocaleString() || 'N/A'}\n`;
        rpt += `**Source:** DeFiLlama + Monad RPC · ${new Date().toISOString().split('T')[0]}\n\n---\n\n`;

        // Live TVL table
        rpt += `## Total Value Locked (Live)\n\n`;
        rpt += `| Chain | TVL | Rank | Top Protocol |\n`;
        rpt += `|-------|-----|------|--------------|\n`;
        for (const name of mentioned) {
            const cd = liveComparison.ok ? liveComparison.comparison[name] : null;
            if (cd) {
                const top = cd.topProtocols.length ? cd.topProtocols[0] : '—';
                rpt += `| **${name}** | ${cd.tvl} | #${cd.rank} | ${top} |\n`;
            } else {
                rpt += `| **${name}** | — | — | — |\n`;
            }
        }

        // Technical specs (static)
        rpt += `\n## Technical Specs\n\n`;
        rpt += `| Chain | TPS | Block Time | Avg Fee | EVM |\n`;
        rpt += `|-------|-----|------------|---------|-----|\n`;
        for (const [, chain] of Object.entries(staticComparison.comparison)) {
            if (mentioned.map(c => c.toLowerCase()).includes(chain.name.toLowerCase())) {
                rpt += `| **${chain.name}** | ${chain.tps} | ${chain.blockTime} | ${chain.avgFee} | ${chain.evmCompatible ? '✓' : '✗'} |\n`;
            }
        }

        // Per-chain details
        rpt += `\n## Ecosystem Details\n\n`;
        for (const name of mentioned) {
            rpt += `### ${name}\n`;
            const cd = liveComparison.ok ? liveComparison.comparison[name] : null;
            if (cd) {
                rpt += `- **TVL:** ${cd.tvl} (Rank #${cd.rank})\n`;
                if (cd.topProtocols.length) rpt += `- **Top Protocols:** ${cd.topProtocols.join(', ')}\n`;
            }
            const sd = Object.values(staticComparison.comparison).find(c => c.name.toLowerCase() === name.toLowerCase());
            if (sd) {
                rpt += `- **Consensus:** ${sd.consensus}\n`;
                rpt += `- **Features:** ${sd.features.join(', ')}\n`;
            }
            rpt += `\n`;
        }

        // AI analysis
        rpt += await this.aiEnhance(
            `Compare these chains with live TVL:\n${mentioned.map(n => { const c = liveComparison.ok ? liveComparison.comparison[n] : {}; return `${n}: TVL ${c?.tvl || '?'}, Rank #${c?.rank || '?'}`; }).join('\n')}\nUser question: "${job.description.substring(0, 300)}"\nWhich chain wins on what metric, trade-offs, recommendations.`,
            'blockchain analyst'
        );

        rpt += `\n---\n*Data: DeFiLlama (live TVL) + Monad RPC · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'Chain Comparison', content: rpt, source: 'DeFiLlama + Monad RPC', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Wallet Analysis (unchanged)
    // ─────────────────────────────────────────────

    async handleWalletAnalysis(job) {
        console.log('   🔍 Wallet analysis (Monad RPC)…');

        const addrMatch = job.description.match(/0x[a-fA-F0-9]{40}/);
        if (!addrMatch) {
            return this.fmt({ jobId: job.id, type: 'Wallet Analysis',
                error: 'No valid wallet address (0x…) found in the task description.' });
        }

        const address  = addrMatch[0];
        const analysis = await this.blockchain.analyzeWallet(address);
        if (!analysis.success) return this.fmt({ jobId: job.id, type: 'Wallet Analysis', error: analysis.error, address });

        // AI-enhanced report
        if (this.hasOpenAI) {
            try {
                const aiReport = await this.callOpenAI(
                    `Wallet data:\n${JSON.stringify(analysis.analysis, null, 2)}\n\nWrite a professional wallet analysis report with executive summary, balance assessment, activity patterns, risk indicators, and key takeaways.`,
                    'You are an expert blockchain data analyst. Use the actual numbers. Provide actionable insights.'
                );
                return this.fmt({ jobId: job.id, type: 'Wallet Analysis', content: aiReport,
                    rawData: analysis.analysis, source: 'Monad RPC + AI', completedAt: new Date().toISOString() });
            } catch (_) { /* fallback */ }
        }

        // Structured fallback
        const a = analysis.analysis;
        const rpt = `# Wallet Analysis Report\n\n**Address:** \`${address}\`\n**Network:** Monad (ID: ${a.network?.chainId || 143})\n**Generated:** ${new Date().toISOString()}\n\n---\n\n## Summary\n\n${a.walletType} with ${a.activity.level.toLowerCase()} activity.\n\n| Metric | Value |\n|--------|-------|\n| Balance | ${a.balance.amount} |\n| Category | ${a.balance.category} |\n| Transactions | ${a.activity.totalTransactions.toLocaleString()} |\n| Activity | ${a.activity.level} |\n| Pattern | ${a.activity.tradingPattern} |\n\n## Insights\n\n${analysis.insights.map(i => `- ${i}`).join('\n')}\n\n---\n*Data: Monad RPC · TaskForge Agent*`;

        return this.fmt({ jobId: job.id, type: 'Wallet Analysis', content: rpt,
            rawData: analysis.analysis, source: 'Monad RPC', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Raw Blockchain Data
    // ─────────────────────────────────────────────

    async handleBlockchainData(job) {
        console.log('   📊 Blockchain data (Monad RPC)…');
        const d = job.description.toLowerCase();
        const addr = job.description.match(/0x[a-fA-F0-9]{40}/);
        const results = {};

        if (d.includes('balance') && addr) results.balance = await this.blockchain.getBalance(addr[0]);
        if (d.includes('network') || d.includes('block') || d.includes('gas')) results.network = await this.blockchain.getNetworkInfo();
        if (d.includes('transaction') && addr) results.txCount = await this.blockchain.getTransactionCount(addr[0]);
        if (addr && d.includes('contract')) results.contract = await this.blockchain.isContract(addr[0]);

        let rpt = `# Blockchain Data Report\n\n**Request:** ${job.description.substring(0, 200)}\n**Generated:** ${new Date().toISOString()}\n\n---\n\n`;
        if (results.balance) rpt += `## Balance\n- **Address:** \`${results.balance.address}\`\n- **Balance:** ${results.balance.balanceMON} MON\n\n`;
        if (results.network) rpt += `## Network\n- **Block:** #${results.network.blockNumber?.toLocaleString()}\n- **Gas:** ${results.network.gasPrice} Gwei\n\n`;
        if (results.txCount) rpt += `## Transactions\n- **Count:** ${results.txCount.transactionCount.toLocaleString()}\n\n`;
        if (results.contract) rpt += `## Contract Check\n- **Is Contract:** ${results.contract.isContract ? 'Yes' : 'No'}\n- **Code Size:** ${results.contract.codeSize} bytes\n\n`;
        rpt += `---\n*Data: Monad RPC · TaskForge Agent*`;

        return this.fmt({ jobId: job.id, type: 'Blockchain Data', content: rpt, rawData: results, source: 'Monad RPC', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Content / Fallback
    // ─────────────────────────────────────────────

    async handleContentJob(job) {
        console.log('   📝 Content job…');
        if (this.hasOpenAI) return await this.processWithOpenAI(job);
        return await this.processDemoMode(job);
    }

    async processWithOpenAI(job) {
        try {
            const content = await this.callOpenAI(this.sanitizeInput(job.description), this.getSystemPrompt(job.categoryName));
            return this.fmt({ jobId: job.id, type: job.categoryName, content, model: 'gpt-4', completedAt: new Date().toISOString() });
        } catch (error) {
            console.error('   OpenAI error:', error.message);
            return await this.processDemoMode(job);
        }
    }

    async processDemoMode(job) {
        console.log('   📋 Demo fallback…');
        await new Promise(r => setTimeout(r, 1000));

        // Even in demo mode, try to enrich with real DeFi data
        const d = job.description.toLowerCase();
        if (this.isDefiSearchJob(d) || this.isYieldJob(d) || this.isChainResearchJob(d) || this.isComparisonJob(d)) {
            // These handlers already use DeFiLlama directly, no OpenAI needed
            if (this.isDefiSearchJob(d))    return await this.handleDefiSearch(job);
            if (this.isYieldJob(d))         return await this.handleYieldResearch(job);
            if (this.isChainResearchJob(d)) return await this.handleChainResearch(job);
            if (this.isComparisonJob(d))    return await this.handleChainComparison(job);
        }

        return this.fmt({
            jobId: job.id, type: job.categoryName || 'Other',
            content: `# Task Report\n\n**Task:** ${job.description.substring(0, 300)}\n**Status:** ✅ Completed\n**Date:** ${new Date().toISOString().split('T')[0]}\n\n---\n\nThis task was processed in demo mode. DeFi data queries (protocol search, yields, chain research) use live DeFiLlama data regardless of mode. For AI-enhanced analysis, configure OPENAI_API_KEY.\n\n---\n*TaskForge Agent (Demo Mode)*`,
            model: 'demo-mode',
            completedAt: new Date().toISOString()
        });
    }

    // ─────────────────────────────────────────────
    //  AI HELPERS
    // ─────────────────────────────────────────────

    async callOpenAI(userPrompt, systemPrompt, maxTokens = 2500) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userPrompt }
                ],
                max_tokens: maxTokens, temperature: 0.7
            }, { signal: controller.signal });
            return response.choices[0].message.content;
        } finally { clearTimeout(timeout); }
    }

    /** Optional AI enhancement — returns markdown section or empty string */
    async aiEnhance(prompt, role) {
        if (!this.hasOpenAI) return '';
        try {
            const analysis = await this.callOpenAI(prompt, `You are a ${role}. Use the ACTUAL data provided. Be specific with numbers. Be concise.`);
            return `\n## AI Analysis\n\n${analysis}\n`;
        } catch (_) { return ''; }
    }

    getSystemPrompt(category) {
        const base = 'You are a professional analyst for TaskForge, an autonomous AI agent platform on Monad. Your outputs are paid work delivered on-chain. Be thorough, accurate, use markdown.';
        const map = {
            'Research':  `${base}\n\nSpecialize in blockchain research. Executive summary, data tables, sources, actionable recommendations.`,
            'Analysis':  `${base}\n\nSpecialize in data analysis. Lead with metrics, tables, patterns, risk assessment, numbered recommendations.`,
            'Content':   `${base}\n\nCrypto content creator. Match format exactly. Twitter threads: numbered <280 chars. Articles: engaging headers.`,
            'Data':      `${base}\n\nData specialist. Clean tables, summary stats, note sources.`,
            'Other':     `${base}\n\nComplete the task thoroughly with clear structure.`,
        };
        return map[category] || map['Other'];
    }

    // ─────────────────────────────────────────────
    //  EVALUATION
    // ─────────────────────────────────────────────

    async evaluateJob(job) {
        const d = job.description.toLowerCase();

        if (this.isWalletAnalysisJob(d)) {
            const has = /0x[a-fA-F0-9]{40}/.test(job.description);
            return { canDo: has, confidence: has ? 95 : 25, reason: has ? 'Wallet analysis via Monad RPC' : 'No address found' };
        }
        if (this.isDefiSearchJob(d))    return { canDo: true, confidence: 95, reason: 'DeFi protocol search via DeFiLlama (live data)' };
        if (this.isYieldJob(d))         return { canDo: true, confidence: 95, reason: 'Yield research via DeFiLlama (live data)' };
        if (this.isChainResearchJob(d)) return { canDo: true, confidence: 95, reason: 'Chain ecosystem research via DeFiLlama (live data)' };
        if (this.isComparisonJob(d))    return { canDo: true, confidence: 95, reason: 'Chain comparison with live TVL from DeFiLlama' };
        if (this.isBlockchainDataJob(d)) return { canDo: true, confidence: 90, reason: 'Blockchain data via Monad RPC' };
        if (this.hasOpenAI)             return { canDo: true, confidence: 90, reason: 'AI processing (GPT-4)' };
        return { canDo: true, confidence: 70, reason: 'Demo mode' };
    }

    // ─────────────────────────────────────────────
    //  UTILITIES
    // ─────────────────────────────────────────────

    // Shared chain lookup
    CHAIN_KEYS = ['monad', 'ethereum', 'solana', 'avalanche', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'bnb', 'fantom', 'sui', 'aptos'];
    CHAIN_MAP  = {
        'monad': 'Monad', 'ethereum': 'Ethereum', 'solana': 'Solana',
        'avalanche': 'Avalanche', 'polygon': 'Polygon', 'arbitrum': 'Arbitrum',
        'optimism': 'Optimism', 'base': 'Base', 'bsc': 'BSC', 'bnb': 'BSC',
        'fantom': 'Fantom', 'sui': 'Sui', 'aptos': 'Aptos',
    };

    detectChain(d) {
        for (const [key, val] of Object.entries(this.CHAIN_MAP)) { if (d.includes(key)) return val; }
        return null;
    }

    fmt(data) { return JSON.stringify(data, null, 2); }
}

module.exports = AIService;
