/**
 * TaskForge API Server v4
 * 
 * Improvements:
 * - Security headers (Helmet-like)
 * - Basic rate limiting (in-memory)
 * - Input validation on all endpoints
 * - Graceful error handling
 * - Request logging
 * - WebSocket heartbeat
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const ContractService = require('./contractService');
const WorkerAgent = require('./worker');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ──────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────

const PORT             = process.env.PORT || 3000;
const RPC_URL          = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const WORKER_PRIVATE_KEY = process.env.WORKER_PRIVATE_KEY;
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;

// Validate
if (!RPC_URL || !CONTRACT_ADDRESS || !WORKER_PRIVATE_KEY) {
    console.error('❌ Missing required environment variables:');
    if (!RPC_URL) console.error('   - RPC_URL');
    if (!CONTRACT_ADDRESS) console.error('   - CONTRACT_ADDRESS');
    if (!WORKER_PRIVATE_KEY) console.error('   - WORKER_PRIVATE_KEY');
    process.exit(1);
}

// ──────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    maxAge: 86400
}));

app.use(express.json({ limit: '16kb' })); // Limit payload size

app.use(express.static(path.join(__dirname, '../website/public'), {
    maxAge: '1h',
    etag: true
}));

// ──────────────────────────────────────────────────
// Rate Limiting (in-memory, production use Redis)
// ──────────────────────────────────────────────────

const rateLimitStore = new Map();

function rateLimit(windowMs, maxRequests) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${ip}:${req.path}`;
        const now = Date.now();

        let record = rateLimitStore.get(key);
        if (!record || now - record.start > windowMs) {
            record = { start: now, count: 0 };
        }

        record.count++;
        rateLimitStore.set(key, record);

        if (record.count > maxRequests) {
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please try again shortly.'
            });
        }

        next();
    };
}

// Clean up stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore) {
        if (now - record.start > 120_000) rateLimitStore.delete(key);
    }
}, 300_000);

// ──────────────────────────────────────────────────
// Input Validation Helpers
// ──────────────────────────────────────────────────

function isValidAddress(addr) {
    return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function isPositiveInt(val, max = 1_000_000) {
    const n = parseInt(val, 10);
    return !isNaN(n) && n >= 1 && n <= max;
}

// ──────────────────────────────────────────────────
// Services
// ──────────────────────────────────────────────────

const contractService = new ContractService(WORKER_PRIVATE_KEY, RPC_URL, CONTRACT_ADDRESS);
let workerAgent = null;

const hasOpenAI = OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-') && OPENAI_API_KEY.length > 20;

// DeFiLlama — free, no key needed
const DefiLlamaService = require('./defiLlamaService');
const defiLlama = new DefiLlamaService();

console.log(`
═══════════════════════════════════════════════════════
  🚀 TASKFORGE API SERVER v5
═══════════════════════════════════════════════════════
${hasOpenAI ? '✅ OpenAI API key configured' : '⚠️  OpenAI not configured — using demo mode'}
✅ Blockchain data fetching enabled
✅ DeFiLlama integration enabled (live DeFi data)
───────────────────────────────────────────────────────
  🌐 Dashboard: http://localhost:${PORT}
  📡 API:       http://localhost:${PORT}/api
  🔌 WebSocket: ws://localhost:${PORT}
───────────────────────────────────────────────────────
  📋 Contract: ${CONTRACT_ADDRESS}
  👛 Worker:   ${contractService.wallet.address}
═══════════════════════════════════════════════════════
`);

// ──────────────────────────────────────────────────
// WebSocket
// ──────────────────────────────────────────────────

const clients = new Set();

wss.on('connection', (ws, req) => {
    clients.add(ws);

    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
});

// Ping every 30s to detect dead connections
const wsHeartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30_000);

wss.on('close', () => clearInterval(wsHeartbeat));

function broadcast(event, data) {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    clients.forEach(client => {
        if (client.readyState === 1) {
            try { client.send(message); } catch (_) { /* ignore */ }
        }
    });
}

// ──────────────────────────────────────────────────
// API ROUTES
// ──────────────────────────────────────────────────

// Config (public, non-sensitive)
app.get('/api/config', rateLimit(60_000, 30), (req, res) => {
    res.json({
        success: true,
        contractAddress: CONTRACT_ADDRESS,
        chainId: 143,
        hasOpenAI: hasOpenAI,
        hasDefiLlama: true
    });
});

// Get jobs (paginated)
app.get('/api/jobs', rateLimit(10_000, 20), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const jobCounter = await contractService.getJobCounter();
        const jobs = [];

        const start = Math.max(1, jobCounter - limit + 1);
        for (let i = jobCounter; i >= start; i--) {
            try {
                const job = await contractService.getJob(i);
                if (job && job.id !== 0) jobs.push(job);
            } catch (_) { /* skip invalid */ }
        }

        res.json({ success: true, jobs, total: jobCounter });
    } catch (error) {
        console.error('GET /api/jobs error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
    }
});

// Get single job
app.get('/api/jobs/:id', rateLimit(5_000, 30), async (req, res) => {
    try {
        if (!isPositiveInt(req.params.id, 1_000_000)) {
            return res.status(400).json({ success: false, error: 'Invalid job ID' });
        }

        const job = await contractService.getJob(parseInt(req.params.id));
        if (!job || job.id === 0) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        res.json({ success: true, job });
    } catch (error) {
        console.error('GET /api/jobs/:id error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch job' });
    }
});

// Stats
app.get('/api/stats', rateLimit(10_000, 20), async (req, res) => {
    try {
        const jobCounter = await contractService.getJobCounter();
        const totalPayouts = await contractService.getTotalPayouts();

        let openJobs = 0;
        for (let i = 1; i <= jobCounter; i++) {
            try {
                if (await contractService.contract.isJobOpen(i)) openJobs++;
            } catch (_) { /* skip */ }
        }

        res.json({
            success: true,
            stats: {
                totalJobs: jobCounter,
                openJobs,
                totalPayouts,
                contractAddress: CONTRACT_ADDRESS,
                workerAddress: contractService.wallet.address
            }
        });
    } catch (error) {
        console.error('GET /api/stats error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
});

// Agent stats
app.get('/api/agents/:address', rateLimit(10_000, 15), async (req, res) => {
    try {
        if (!isValidAddress(req.params.address)) {
            return res.status(400).json({ success: false, error: 'Invalid address' });
        }
        const stats = await contractService.getAgentStats(req.params.address);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('GET /api/agents/:address error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch agent stats' });
    }
});

// ──────────────────────────────────────────────────
// Worker Agent Controls
// ──────────────────────────────────────────────────

app.get('/api/worker/status', rateLimit(5_000, 20), async (req, res) => {
    try {
        const { ethers } = require('ethers');
        const balance = await contractService.provider.getBalance(contractService.wallet.address);

        res.json({
            success: true,
            status: {
                isRunning: workerAgent !== null && workerAgent.isRunning,
                address: contractService.wallet.address,
                balance: ethers.formatEther(balance),
                activeJobs: workerAgent?.activeJobs?.length || 0,
                hasOpenAI: hasOpenAI,
                hasBlockchainData: true,
                hasDefiLlama: true
            }
        });
    } catch (error) {
        console.error('GET /api/worker/status error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to get worker status' });
    }
});

app.post('/api/worker/start', rateLimit(60_000, 5), async (req, res) => {
    try {
        if (workerAgent && workerAgent.isRunning) {
            return res.json({ success: true, message: 'Worker already running' });
        }

        workerAgent = new WorkerAgent(contractService, OPENAI_API_KEY, RPC_URL);

        workerAgent.on('jobClaimed', data => broadcast('job_claimed', data));
        workerAgent.on('jobSubmitted', data => broadcast('job_submitted', data));
        workerAgent.on('jobCompleted', data => broadcast('job_completed', data));

        await workerAgent.start();
        broadcast('worker_started', { address: contractService.wallet.address });

        res.json({ success: true, message: 'Worker started' });
    } catch (error) {
        console.error('POST /api/worker/start error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to start worker' });
    }
});

app.post('/api/worker/stop', rateLimit(60_000, 5), async (req, res) => {
    try {
        if (workerAgent) {
            await workerAgent.stop();
            broadcast('worker_stopped', { address: contractService.wallet.address });
        }
        res.json({ success: true, message: 'Worker stopped' });
    } catch (error) {
        console.error('POST /api/worker/stop error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to stop worker' });
    }
});

// ──────────────────────────────────────────────────
// Blockchain Data API
// ──────────────────────────────────────────────────

const BlockchainService = require('./blockchainService');
const blockchainService = new BlockchainService(RPC_URL);

app.get('/api/blockchain/balance/:address', rateLimit(5_000, 15), async (req, res) => {
    try {
        if (!isValidAddress(req.params.address)) {
            return res.status(400).json({ success: false, error: 'Invalid address' });
        }
        const result = await blockchainService.getBalance(req.params.address);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/blockchain/analyze/:address', rateLimit(10_000, 10), async (req, res) => {
    try {
        if (!isValidAddress(req.params.address)) {
            return res.status(400).json({ success: false, error: 'Invalid address' });
        }
        const result = await blockchainService.analyzeWallet(req.params.address);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/blockchain/network', rateLimit(10_000, 20), async (req, res) => {
    try {
        const result = await blockchainService.getNetworkInfo();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/blockchain/compare', rateLimit(30_000, 10), async (req, res) => {
    try {
        const result = await blockchainService.getChainComparison();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ──────────────────────────────────────────────────
// DeFiLlama API (live DeFi data — free, no key)
// ──────────────────────────────────────────────────

// Search protocols
app.get('/api/defi/protocols', rateLimit(10_000, 15), async (req, res) => {
    try {
        const { query, chain, category, limit } = req.query;
        const result = await defiLlama.searchProtocols({
            query:    typeof query === 'string' ? query.slice(0, 100) : '',
            chain:    typeof chain === 'string' ? chain.slice(0, 30) : undefined,
            category: typeof category === 'string' ? category.slice(0, 30) : undefined,
            limit:    Math.min(Math.max(parseInt(limit) || 15, 1), 50)
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Protocol search failed' });
    }
});

// Protocol detail (by slug)
app.get('/api/defi/protocol/:slug', rateLimit(5_000, 15), async (req, res) => {
    try {
        const slug = (req.params.slug || '').replace(/[^a-z0-9\-_.]/gi, '').slice(0, 100);
        if (!slug) return res.status(400).json({ ok: false, error: 'Invalid slug' });
        const result = await defiLlama.getProtocolDetail(slug);
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Protocol detail failed' });
    }
});

// Chain TVL rankings
app.get('/api/defi/chains', rateLimit(10_000, 15), async (req, res) => {
    try {
        const result = await defiLlama.getChainsTVL();
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Chain data failed' });
    }
});

// Single chain TVL + history
app.get('/api/defi/chain/:name', rateLimit(10_000, 15), async (req, res) => {
    try {
        const name = (req.params.name || '').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30);
        if (!name) return res.status(400).json({ ok: false, error: 'Invalid chain name' });
        const result = await defiLlama.getChainTVL(name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Chain TVL query failed' });
    }
});

// Chain DeFi overview (protocols + yields + TVL)
app.get('/api/defi/chain/:name/overview', rateLimit(30_000, 10), async (req, res) => {
    try {
        const name = (req.params.name || '').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30);
        if (!name) return res.status(400).json({ ok: false, error: 'Invalid chain name' });
        const result = await defiLlama.chainOverview(name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Chain overview failed' });
    }
});

// Yield pools
app.get('/api/defi/yields', rateLimit(10_000, 15), async (req, res) => {
    try {
        const { chain, project, stable, limit } = req.query;
        const result = await defiLlama.getYields({
            chain:     typeof chain === 'string' ? chain.slice(0, 30) : undefined,
            project:   typeof project === 'string' ? project.slice(0, 50) : undefined,
            stableOnly: stable === 'true',
            limit:     Math.min(Math.max(parseInt(limit) || 15, 1), 50)
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Yield data failed' });
    }
});

// DEX volumes
app.get('/api/defi/dex-volumes', rateLimit(10_000, 10), async (req, res) => {
    try {
        const result = await defiLlama.getDexVolumes();
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'DEX volume query failed' });
    }
});

// Stablecoins
app.get('/api/defi/stablecoins', rateLimit(10_000, 10), async (req, res) => {
    try {
        const result = await defiLlama.getStablecoins();
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Stablecoin query failed' });
    }
});

// Compare chains
app.get('/api/defi/compare', rateLimit(30_000, 10), async (req, res) => {
    try {
        let chains = req.query.chains;
        if (typeof chains === 'string') {
            chains = chains.split(',').map(c => c.trim()).filter(Boolean).slice(0, 8);
        } else {
            chains = ['Ethereum', 'Solana', 'Arbitrum', 'Base'];
        }
        const result = await defiLlama.compareChains(chains);
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Chain comparison failed' });
    }
});

// ──────────────────────────────────────────────────
// Serve Frontend (catch-all)
// ──────────────────────────────────────────────────

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../website/public/index.html'));
});

// Global error handler
app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ──────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`\n🌐 Server running at http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down…');
    if (workerAgent) await workerAgent.stop();
    wss.close();
    server.close();
    process.exit(0);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
