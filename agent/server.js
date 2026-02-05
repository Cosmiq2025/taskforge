/**
 * API Server - Agent Jobs Protocol
 * REST API + WebSocket for real-time updates
 * Supports ALL EVM wallets (not just MetaMask)
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

// Get open jobs
app.get('/api/jobs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const jobs = await contractService.getOpenJobs(limit);
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get ALL jobs (including completed)
app.get('/api/jobs/all', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const jobs = await contractService.getAllJobs(limit);
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get job by ID
app.get('/api/jobs/:id', async (req, res) => {
    try {
        const job = await contractService.getJob(parseInt(req.params.id));
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Post new job (for server-side posting, not MetaMask)
app.post('/api/jobs', async (req, res) => {
    try {
        const { description, category, payment, deadlineHours } = req.body;
        
        if (!description || payment === undefined) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const result = await contractService.postJob(
            description,
            category || 0,
            payment,
            deadlineHours || 24
        );
        
        broadcast('job_posted', { jobId: result.jobId, txHash: result.txHash });
        
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get protocol stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await contractService.getStats();
        stats.workerAddress = contractService.wallet.address;
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get agent stats
app.get('/api/agents/:address', async (req, res) => {
    try {
        const stats = await contractService.getAgentStats(req.params.address);
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get recent activity
app.get('/api/activity', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const activity = await contractService.getRecentActivity(limit);
        res.json({ success: true, activity });
    } catch (error) {
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
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/worker/start', async (req, res) => {
    try {
        if (workerAgent && workerAgent.isRunning) {
            return res.json({ success: true, message: 'Worker already running' });
        }
        
        // Pass RPC_URL to worker for blockchain data fetching
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// BLOCKCHAIN DATA API (for direct queries)
// ============================================

const BlockchainService = require('./blockchainService');
const blockchainService = new BlockchainService(RPC_URL);

// Get wallet balance
app.get('/api/blockchain/balance/:address', async (req, res) => {
    try {
        const result = await blockchainService.getBalance(req.params.address);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Analyze wallet
app.get('/api/blockchain/analyze/:address', async (req, res) => {
    try {
        const result = await blockchainService.analyzeWallet(req.params.address);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get network info
app.get('/api/blockchain/network', async (req, res) => {
    try {
        const result = await blockchainService.getNetworkInfo();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get chain comparison
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

// Serve index.html for all other routes (SPA support)
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
