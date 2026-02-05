/**
 * Worker Agent - Agent Jobs Protocol
 * 
 * Autonomous agent that:
 * - Scans for open jobs
 * - Evaluates if it can complete them
 * - Claims suitable jobs
 * - Uses AI + blockchain data to complete work
 * - Submits results on-chain
 */

const { EventEmitter } = require('events');
const AIService = require('./aiService');

class WorkerAgent extends EventEmitter {
    constructor(contractService, openaiKey, rpcUrl) {
        super();
        this.contract = contractService;
        this.aiService = new AIService(openaiKey, rpcUrl);
        this.isRunning = false;
        this.scanInterval = 30000; // 30 seconds
        this.minPayment = 0.01; // Minimum payment in MON
        this.activeJobs = [];
        this.intervalId = null;
    }

    async start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        const { ethers } = require('ethers');
        const balance = await this.contract.provider.getBalance(this.contract.wallet.address);
        
        console.log(`
═══════════════════════════════════════════════════════
  🤖 WORKER AGENT STARTING
═══════════════════════════════════════════════════════
  Wallet: ${this.contract.wallet.address}
  Balance: ${ethers.formatEther(balance)} MON
  Scan interval: ${this.scanInterval / 1000}s
  Min payment: ${this.minPayment} MON
═══════════════════════════════════════════════════════
`);
        
        // Initial scan
        await this.scanAndProcess();
        
        // Set up interval
        this.intervalId = setInterval(() => this.scanAndProcess(), this.scanInterval);
    }

    async stop() {
        console.log('\n🛑 Worker agent stopping...');
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async scanAndProcess() {
        if (!this.isRunning) return;
        
        try {
            console.log('\n🔍 Scanning for jobs...');
            
            // Get open jobs
            const jobs = await this.contract.getOpenJobs(20);
            
            // Filter jobs we can potentially do
            const suitableJobs = jobs.filter(job => 
                parseFloat(job.payment) >= this.minPayment
            );
            
            console.log(`   Found ${jobs.length} open jobs`);
            console.log(`   ${suitableJobs.length} suitable jobs`);
            
            // Process each suitable job
            for (const job of suitableJobs) {
                if (!this.isRunning) break;
                
                // Skip if we're already working on it
                if (this.activeJobs.includes(job.id)) continue;
                
                // Evaluate if we can do this job
                const evaluation = await this.evaluateJob(job);
                
                console.log(`\n📋 Evaluating job #${job.id}: "${job.description.substring(0, 50)}..."`);
                console.log(`   Can do: ${evaluation.canDo}`);
                console.log(`   Confidence: ${evaluation.confidence}%`);
                console.log(`   Reason: ${evaluation.reason}`);
                
                if (evaluation.canDo && evaluation.confidence >= 70) {
                    await this.processJob(job);
                }
            }
        } catch (error) {
            console.error('Error scanning jobs:', error.message);
        }
    }

    async evaluateJob(job) {
        return await this.aiService.evaluateJob(job);
    }

    async processJob(job) {
        try {
            // Claim the job
            console.log(`\n🎯 Attempting to claim job #${job.id}...`);
            const claimed = await this.claimJob(job);
            
            if (!claimed) return;
            
            this.activeJobs.push(job.id);
            
            // Do the work
            console.log(`\n⚙️ Working on job #${job.id}...`);
            const result = await this.doWork(job);
            
            // Submit result
            console.log(`\n📤 Submitting result for job #${job.id}...`);
            await this.submitResult(job.id, result);
            
            // Remove from active jobs
            this.activeJobs = this.activeJobs.filter(id => id !== job.id);
            
        } catch (error) {
            console.error(`Error processing job #${job.id}:`, error.message);
            this.activeJobs = this.activeJobs.filter(id => id !== job.id);
        }
    }

    async claimJob(job) {
        try {
            console.log(`🎯 Claiming job #${job.id}...`);
            console.log(`   Stake required: ${job.stakeRequired} MON`);
            
            const result = await this.contract.claimJob(job.id);
            
            console.log(`   ✅ Job #${job.id} claimed!`);
            console.log(`   TX: ${result.txHash}`);
            
            this.emit('jobClaimed', { 
                jobId: job.id, 
                worker: this.contract.wallet.address,
                txHash: result.txHash 
            });
            
            return true;
        } catch (error) {
            console.log(`   ❌ Failed to claim: ${error.message}`);
            return false;
        }
    }

    async doWork(job) {
        console.log(`🤖 Processing job #${job.id} with AI...`);
        
        try {
            const result = await this.aiService.processJob(job);
            console.log(`   ✅ Work completed for job #${job.id}`);
            return result;
        } catch (error) {
            console.error(`   ❌ AI processing failed:`, error.message);
            throw error;
        }
    }

    async submitResult(jobId, result) {
        try {
            const txResult = await this.contract.submitResult(jobId, result);
            
            console.log(`   ✅ Job #${jobId} submitted!`);
            console.log(`   TX: ${txResult.txHash}`);
            
            this.emit('jobSubmitted', { 
                jobId, 
                txHash: txResult.txHash 
            });
            
        } catch (error) {
            console.error(`   ❌ Failed to submit result:`, error.message);
            throw error;
        }
    }
}

module.exports = WorkerAgent;
