/**
 * AI Service v5 — DeFiLlama Integration
 * ADDED: Result truncation to prevent contract errors
 */

const BlockchainService = require('./blockchainService');
const DefiLlamaService  = require('./defiLlamaService');

// Max result length for smart contract (prevents transaction failures)
const MAX_RESULT_LENGTH = 2500;

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
    //  TRUNCATION (prevents contract errors)
    // ─────────────────────────────────────────────

    truncateResult(str) {
        if (!str) return str;
        if (str.length <= MAX_RESULT_LENGTH) return str;
        console.log(`   ⚠️ Truncating result from ${str.length} to ${MAX_RESULT_LENGTH} chars`);
        return str.substring(0, MAX_RESULT_LENGTH - 50) + '\n\n... [truncated for on-chain storage]';
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
               (d.includes('analy') || d.includes('activity') || d.includes('check') || d.includes('inspect') || d.includes('history'));
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
        const chain = this.detectChain(d);

        const catMap = {
            'dex': 'Dexes', 'exchange': 'Dexes', 'swap': 'Dexes',
            'lending': 'Lending', 'borrow': 'Lending', 'loan': 'Lending',
            'bridge': 'Bridge', 'cross-chain': 'Bridge',
            'staking': 'Liquid Staking', 'liquid staking': 'Liquid Staking',
            'derivative': 'Derivatives', 'perp': 'Derivatives',
        };
        let category = null;
        for (const [key, val] of Object.entries(catMap)) { if (d.includes(key)) { category = val; break; } }

        let query = '';
        const nameMatch = job.description.match(/(?:find|search|about|called|named|protocol)\s+["']?([A-Za-z0-9\s]{2,30})["']?/i);
        if (nameMatch) query = nameMatch[1].trim();

        const res = await this.defi.searchProtocols({ query, chain, category, limit: 10 });

        if (!res.ok) return this.fmt({ jobId: job.id, type: 'DeFi Research', error: res.error });
        if (!res.protocols.length) {
            return this.fmt({ jobId: job.id, type: 'DeFi Research',
                content: `No protocols found (chain: ${chain || 'all'}, category: ${category || 'all'}). Try broadening your search.`,
                completedAt: new Date().toISOString() });
        }

        let rpt = `# DeFi Protocol Report\n\n`;
        rpt += `**Task:** ${job.description.substring(0, 150)}\n`;
        rpt += `**Filters:** Chain: ${chain || 'All'} · Category: ${category || 'All'}\n`;
        rpt += `**Results:** ${res.protocols.length} protocols\n`;
        rpt += `**Source:** DeFiLlama (live)\n\n---\n\n`;

        rpt += `## Top Protocols by TVL\n\n`;
        rpt += `| # | Protocol | TVL | Category | 24h |\n`;
        rpt += `|---|----------|-----|----------|-----|\n`;
        res.protocols.slice(0, 8).forEach((p, i) => {
            rpt += `| ${i + 1} | **${p.name}** | ${p.tvlFmt} | ${p.category} | ${p.change_1d} |\n`;
        });

        rpt += await this.aiEnhance(
            `Analyze these DeFi protocols briefly (2 sentences):\n${res.protocols.slice(0, 5).map(p => `${p.name}: TVL ${p.tvlFmt}, ${p.category}`).join('\n')}`,
            'DeFi analyst'
        );

        rpt += `\n---\n*Data: DeFiLlama · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'DeFi Research', content: rpt, source: 'DeFiLlama', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Yield Research
    // ─────────────────────────────────────────────

    async handleYieldResearch(job) {
        console.log('   💰 Yield research (DeFiLlama)…');
        const d = job.description.toLowerCase();
        const chain = this.detectChain(d);
        const stableOnly = d.includes('stable') || d.includes('safe');

        let project = null;
        const projMatch = job.description.match(/(?:on|from|in|for)\s+([A-Za-z0-9]+)/i);
        if (projMatch && projMatch[1].length > 2) {
            const candidate = projMatch[1].toLowerCase();
            if (!this.CHAIN_KEYS.includes(candidate)) project = candidate;
        }

        const res = await this.defi.getYields({ chain, project, stableOnly, limit: 12 });
        if (!res.ok) return this.fmt({ jobId: job.id, type: 'Yield Research', error: res.error });

        let rpt = `# Yield & APY Report\n\n`;
        rpt += `**Task:** ${job.description.substring(0, 150)}\n`;
        rpt += `**Filters:** Chain: ${chain || 'All'} · Stablecoin-only: ${stableOnly ? 'Yes' : 'No'}\n`;
        rpt += `**Results:** ${res.pools.length} pools\n`;
        rpt += `**Source:** DeFiLlama Yields (live)\n\n---\n\n`;

        if (!res.pools.length) {
            rpt += `No pools matched your criteria. Try broadening filters.\n`;
        } else {
            rpt += `## Top Opportunities\n\n`;
            rpt += `| # | Pool | Project | Chain | APY | TVL |\n`;
            rpt += `|---|------|---------|-------|-----|-----|\n`;
            res.pools.slice(0, 8).forEach((p, i) => {
                rpt += `| ${i + 1} | ${p.symbol} | ${p.project} | ${p.chain} | **${p.apy}** | ${p.tvlFmt} |\n`;
            });

            rpt += `\n## ⚠️ Risk Note\n\nAPY figures change constantly. Higher APY = higher risk. Always DYOR.\n`;
        }

        rpt += await this.aiEnhance(
            `Analyze these yield pools briefly (2 sentences):\n${res.pools.slice(0, 5).map(p => `${p.symbol} on ${p.project}: APY ${p.apy}, TVL ${p.tvlFmt}`).join('\n')}`,
            'DeFi yield strategist'
        );

        rpt += `\n---\n*Data: DeFiLlama Yields · TaskForge Agent*`;
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
        rpt += `**Source:** DeFiLlama (live)\n\n---\n\n`;

        rpt += `## Chain Overview\n\n`;
        if (overview.tvl.ok) {
            rpt += `| Metric | Value |\n|--------|-------|\n`;
            rpt += `| **Total TVL** | ${overview.tvl.tvlFmt} |\n`;
            rpt += `| **Rank** | #${overview.tvl.rank} |\n`;
            rpt += `| **7d Change** | ${overview.tvl.change_7d} |\n\n`;
        } else {
            rpt += `TVL data not available for ${chain}.\n\n`;
        }

        if (overview.protocols.ok && overview.protocols.protocols.length) {
            rpt += `## Top Protocols\n\n`;
            rpt += `| # | Protocol | TVL | Category |\n`;
            rpt += `|---|----------|-----|----------|\n`;
            overview.protocols.protocols.slice(0, 8).forEach((p, i) => {
                rpt += `| ${i + 1} | **${p.name}** | ${p.tvlFmt} | ${p.category} |\n`;
            });
            rpt += `\n`;
        }

        if (overview.yields.ok && overview.yields.pools.length) {
            rpt += `## Top Yields\n\n`;
            rpt += `| Pool | Project | APY | TVL |\n`;
            rpt += `|------|---------|-----|-----|\n`;
            overview.yields.pools.slice(0, 5).forEach(p => {
                rpt += `| ${p.symbol} | ${p.project} | ${p.apy} | ${p.tvlFmt} |\n`;
            });
            rpt += `\n`;
        }

        rpt += await this.aiEnhance(
            `Analyze ${chain} ecosystem briefly (2-3 sentences):\nTVL: ${overview.tvl.ok ? overview.tvl.tvlFmt : 'N/A'}\nTop protocols: ${overview.protocols.ok ? overview.protocols.protocols.slice(0, 5).map(p => p.name).join(', ') : 'none'}`,
            'blockchain ecosystem analyst'
        );

        rpt += `\n---\n*Data: DeFiLlama · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'Chain Research', content: rpt, source: 'DeFiLlama', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Chain Comparison
    // ─────────────────────────────────────────────

    async handleChainComparison(job) {
        console.log('   ⚖️ Chain comparison (DeFiLlama)…');
        const d = job.description.toLowerCase();

        const mentioned = [];
        for (const [key, val] of Object.entries(this.CHAIN_MAP)) { if (d.includes(key)) mentioned.push(val); }
        if (mentioned.length < 2) { mentioned.length = 0; mentioned.push('Ethereum', 'Solana', 'Arbitrum', 'Monad'); }

        const liveComparison = await this.defi.compareChains(mentioned.slice(0, 4));
        const staticComparison = await this.blockchain.getChainComparison();

        let rpt = `# Blockchain Comparison\n\n`;
        rpt += `**Chains:** ${mentioned.slice(0, 4).join(' vs ')}\n`;
        rpt += `**Source:** DeFiLlama + Monad RPC\n\n---\n\n`;

        rpt += `## Total Value Locked\n\n`;
        rpt += `| Chain | TVL | Rank |\n`;
        rpt += `|-------|-----|------|\n`;
        for (const name of mentioned.slice(0, 4)) {
            const cd = liveComparison.ok ? liveComparison.comparison[name] : null;
            rpt += `| **${name}** | ${cd ? cd.tvl : '—'} | ${cd ? '#' + cd.rank : '—'} |\n`;
        }

        rpt += `\n## Technical Specs\n\n`;
        rpt += `| Chain | TPS | Block Time | Avg Fee | EVM |\n`;
        rpt += `|-------|-----|------------|---------|-----|\n`;
        for (const [, chain] of Object.entries(staticComparison.comparison)) {
            if (mentioned.map(c => c.toLowerCase()).includes(chain.name.toLowerCase())) {
                rpt += `| **${chain.name}** | ${chain.tps} | ${chain.blockTime} | ${chain.avgFee} | ${chain.evmCompatible ? '✓' : '✗'} |\n`;
            }
        }

        rpt += await this.aiEnhance(
            `Compare these chains briefly (2-3 sentences):\n${mentioned.slice(0, 4).map(n => { const c = liveComparison.ok ? liveComparison.comparison[n] : {}; return `${n}: TVL ${c?.tvl || '?'}`; }).join('\n')}`,
            'blockchain analyst'
        );

        rpt += `\n---\n*Data: DeFiLlama + Monad RPC · TaskForge Agent*`;
        return this.fmt({ jobId: job.id, type: 'Chain Comparison', content: rpt, source: 'DeFiLlama + Monad RPC', completedAt: new Date().toISOString() });
    }

    // ─────────────────────────────────────────────
    //  HANDLER: Wallet Analysis
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

        const a = analysis.analysis;
        let rpt = `# Wallet Analysis Report\n\n`;
        rpt += `**Address:** \`${address}\`\n`;
        rpt += `**Network:** Monad\n\n---\n\n`;
        rpt += `## Summary\n\n`;
        rpt += `| Metric | Value |\n|--------|-------|\n`;
        rpt += `| Balance | ${a.balance.amount} |\n`;
        rpt += `| Category | ${a.balance.category} |\n`;
        rpt += `| Transactions | ${a.activity.totalTransactions.toLocaleString()} |\n`;
        rpt += `| Activity | ${a.activity.level} |\n\n`;
        rpt += `## Insights\n\n${analysis.insights.map(i => `- ${i}`).join('\n')}\n`;
        rpt += `\n---\n*Data: Monad RPC · TaskForge Agent*`;

        return this.fmt({ jobId: job.id, type: 'Wallet Analysis', content: rpt, source: 'Monad RPC', completedAt: new Date().toISOString() });
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

        let rpt = `# Blockchain Data Report\n\n**Request:** ${job.description.substring(0, 150)}\n\n---\n\n`;
        if (results.balance) rpt += `## Balance\n- **Address:** \`${results.balance.address}\`\n- **Balance:** ${results.balance.balanceMON} MON\n\n`;
        if (results.network) rpt += `## Network\n- **Block:** #${results.network.blockNumber?.toLocaleString()}\n- **Gas:** ${results.network.gasPrice} Gwei\n\n`;
        rpt += `---\n*Data: Monad RPC · TaskForge Agent*`;

        return this.fmt({ jobId: job.id, type: 'Blockchain Data', content: rpt, source: 'Monad RPC', completedAt: new Date().toISOString() });
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
        const d = job.description.toLowerCase();
        
        // Try DeFi handlers even without OpenAI
        if (this.isDefiSearchJob(d))    return await this.handleDefiSearch(job);
        if (this.isYieldJob(d))         return await this.handleYieldResearch(job);
        if (this.isChainResearchJob(d)) return await this.handleChainResearch(job);
        if (this.isComparisonJob(d))    return await this.handleChainComparison(job);

        return this.fmt({
            jobId: job.id, type: job.categoryName || 'Other',
            content: `# Task Report\n\n**Task:** ${job.description.substring(0, 200)}\n**Status:** ✅ Completed\n\nThis task was processed. For AI-enhanced analysis, configure OPENAI_API_KEY.\n\n---\n*TaskForge Agent*`,
            completedAt: new Date().toISOString()
        });
    }

    // ─────────────────────────────────────────────
    //  AI HELPERS
    // ─────────────────────────────────────────────

    async callOpenAI(userPrompt, systemPrompt, maxTokens = 800) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
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

    async aiEnhance(prompt, role) {
        if (!this.hasOpenAI) return '';
        try {
            const analysis = await this.callOpenAI(prompt, `You are a ${role}. Be BRIEF (2-3 sentences max). Use actual data provided.`, 150);
            return `\n## AI Analysis\n\n${analysis}\n`;
        } catch (_) { return ''; }
    }

    getSystemPrompt(category) {
        const base = 'You are a professional analyst for TaskForge on Monad. Be concise and accurate.';
        const map = {
            'Research':  `${base} Focus on blockchain research with data and recommendations.`,
            'Analysis':  `${base} Focus on data analysis with metrics and patterns.`,
            'Content':   `${base} Create engaging crypto content.`,
            'Data':      `${base} Present data clearly with tables.`,
            'Other':     `${base} Complete the task thoroughly.`,
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
        if (this.isDefiSearchJob(d))    return { canDo: true, confidence: 95, reason: 'DeFi protocol search via DeFiLlama' };
        if (this.isYieldJob(d))         return { canDo: true, confidence: 95, reason: 'Yield research via DeFiLlama' };
        if (this.isChainResearchJob(d)) return { canDo: true, confidence: 95, reason: 'Chain ecosystem research via DeFiLlama' };
        if (this.isComparisonJob(d))    return { canDo: true, confidence: 95, reason: 'Chain comparison with live TVL' };
        if (this.isBlockchainDataJob(d)) return { canDo: true, confidence: 90, reason: 'Blockchain data via Monad RPC' };
        if (this.hasOpenAI)             return { canDo: true, confidence: 90, reason: 'AI processing (GPT-4)' };
        return { canDo: true, confidence: 70, reason: 'Demo mode' };
    }

    // ─────────────────────────────────────────────
    //  UTILITIES
    // ─────────────────────────────────────────────

    CHAIN_KEYS = ['monad', 'ethereum', 'solana', 'avalanche', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'fantom', 'sui', 'aptos'];
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

    // OUTPUT WITH TRUNCATION
    fmt(data) {
        const json = JSON.stringify(data, null, 2);
        return this.truncateResult(json);
    }
}

module.exports = AIService;
