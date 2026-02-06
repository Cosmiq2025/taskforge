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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../website/public')));

// Configuration
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const WORKER_PRIVATE_KEY = process.env.WORKER_PRIVATE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validate required config
if (!RPC_URL || !CONTRACT_ADDRESS || !WORKER_PRIVATE_KEY) {
    console.error('❌ Missing required environment variables:');
    if (!RPC_URL) console.error('   - RPC_URL');
    if (!CONTRACT_ADDRESS) console.error('   - CONTRACT_ADDRESS');
    if (!WORKER_PRIVATE_KEY) console.error('   - WORKER_PRIVATE_KEY');
    process.exit(1);
}

// Initialize services
const contractService = new ContractService(WORKER_PRIVATE_KEY, RPC_URL, CONTRACT_ADDRESS);
let workerAgent = null;

// Check OpenAI status
const hasOpenAI = OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-') && OPENAI_API_KEY.length > 20;

console.log(`
═══════════════════════════════════════════════════════
  🚀 AGENT JOBS API SERVER
═══════════════════════════════════════════════════════
${hasOpenAI ? '✅ OpenAI API key configured' : '⚠️  OpenAI not configured - using demo mode'}
✅ Blockchain data fetching enabled
───────────────────────────────────────────────────────
  🌐 Dashboard: http://localhost:${PORT}
  📡 API: http://localhost:${PORT}/api
  🔌 WebSocket: ws://localhost:${PORT}
───────────────────────────────────────────────────────
  📋 Contract: ${CONTRACT_ADDRESS}
  👛 Worker Wallet: ${contractService.wallet.address}
═══════════════════════════════════════════════════════
`);

// WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('📡 Client connected');
    
    ws.on('close', () => {
        clients.delete(ws);
    });
});

// Broadcast to all clients
function broadcast(event, data) {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(message);
        }
    });
}

// ============================================
// API ROUTES
// ============================================

// NEW: Config endpoint for contract address
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        contractAddress: CONTRACT_ADDRESS,
        rpcUrl: RPC_URL,
        hasOpenAI: hasOpenAI
    });
});

// Get open jobs
// Get ALL jobs (Fix for visibility)
app.get('/api/jobs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const jobCounter = await contractService.getJobCounter();
        const jobs = [];
        
        // Fetch jobs starting from the most recent
        const start = Math.max(1, jobCounter - limit + 1);
        for (let i = jobCounter; i >= start; i--) {
            try {
                const job = await contractService.getJob(i);
                if (job && job.id !== 0) {
                    jobs.push(job);
                }
            } catch (e) {
                console.error(`Error fetching job ${i}:`, e);
            }
        }
        
        res.json({ success: true, jobs });
    } catch (error) {
        console.error('Get jobs error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Get job by ID
app.get('/api/jobs/:id', async (req, res) => {
    try {
        const job = await contractService.getJob(parseInt(req.params.id));
        if (!job || job.id === 0) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        res.json({ success: true, job });
    } catch (error) {
        console.error('Get job error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get protocol stats (FIXED: includes contract address)
app.get('/api/stats', async (req, res) => {
    try {
        const jobCounter = await contractService.getJobCounter();
        const totalPayouts = await contractService.getTotalPayouts();
        
        // Count open jobs
        let openJobs = 0;
        for (let i = 1; i <= jobCounter; i++) {
            try {
                const isOpen = await contractService.contract.isJobOpen(i);
                if (isOpen) openJobs++;
            } catch (e) {
                // Skip invalid jobs
            }
        }
        
        res.json({
            success: true,
            stats: {
                totalJobs: jobCounter,
                openJobs: openJobs,
                totalPayouts: totalPayouts,
                contractAddress: CONTRACT_ADDRESS, // ADDED THIS
                workerAddress: contractService.wallet.address
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get agent stats
app.get('/api/agents/:address', async (req, res) => {
    try {
        const stats = await contractService.getAgentStats(req.params.address);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Get agent stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// WORKER AGENT CONTROLS
// ============================================

app.get('/api/worker/status', async (req, res) => {
    try {
        const balance = await contractService.provider.getBalance(contractService.wallet.address);
        const { ethers } = require('ethers');
        
        res.json({
            success: true,
            status: {
                isRunning: workerAgent !== null && workerAgent.isRunning,
                address: contractService.wallet.address,
                balance: ethers.formatEther(balance),
                activeJobs: workerAgent?.activeJobs?.length || 0,
                hasOpenAI: hasOpenAI,
                hasBlockchainData: true
            }
        });
    } catch (error) {
        console.error('Worker status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/worker/start', async (req, res) => {
    try {
        if (workerAgent && workerAgent.isRunning) {
            return res.json({ success: true, message: 'Worker already running' });
        }
        
        workerAgent = new WorkerAgent(contractService, OPENAI_API_KEY, RPC_URL);
        
        // Set up event handlers
        workerAgent.on('jobClaimed', (data) => {
            broadcast('job_claimed', data);
        });
        
        workerAgent.on('jobSubmitted', (data) => {
            broadcast('job_submitted', data);
        });
        
        workerAgent.on('jobCompleted', (data) => {
            broadcast('job_completed', data);
        });
        
        await workerAgent.start();
        broadcast('worker_started', { address: contractService.wallet.address });
        
        res.json({ success: true, message: 'Worker started' });
    } catch (error) {
        console.error('Worker start error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/worker/stop', async (req, res) => {
    try {
        if (workerAgent) {
            await workerAgent.stop();
            broadcast('worker_stopped', { address: contractService.wallet.address });
        }
        res.json({ success: true, message: 'Worker stopped' });
    } catch (error) {
        console.error('Worker stop error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// BLOCKCHAIN DATA API
// ============================================

const BlockchainService = require('./blockchainService');
const blockchainService = new BlockchainService(RPC_URL);

app.get('/api/blockchain/balance/:address', async (req, res) => {
    try {
        const result = await blockchainService.getBalance(req.params.address);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/blockchain/analyze/:address', async (req, res) => {
    try {
        const result = await blockchainService.analyzeWallet(req.params.address);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/blockchain/network', async (req, res) => {
    try {
        const result = await blockchainService.getNetworkInfo();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/blockchain/compare', async (req, res) => {
    try {
        const result = await blockchainService.getChainComparison();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// SERVE FRONTEND
// ============================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../website/public/index.html'));
});

// Start server
server.listen(PORT, () => {
    console.log(`\n🌐 Server running at http://localhost:${PORT}\n`);
});

// Handle shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (workerAgent) {
        await workerAgent.stop();
    }
    process.exit(0);
});
