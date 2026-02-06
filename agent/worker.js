/**
 * Worker Agent v4
 * 
 * Improvements:
 * - Retry logic for failed claims
 * - Concurrent job limit
 * - Better error recovery
 * - Job processing timeout
 */

const { EventEmitter } = require('events');
const AIService = require('./aiService');

class WorkerAgent extends EventEmitter {
    constructor(contractService, openaiKey, rpcUrl) {
        super();
        this.contract = contractService;
        this.aiService = new AIService(openaiKey, rpcUrl);
        this.isRunning = false;
        this.scanInterval = 30_000;
        this.minPayment = 0.01;
        this.maxConcurrentJobs = 3;
        this.activeJobs = [];
        this.failedJobs = new Set(); // Track failed jobs to avoid retrying
        this.intervalId = null;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        const { ethers } = require('ethers');
        const balance = await this.contract.provider.getBalance(this.contract.wallet.address);

        console.log(`
═══════════════════════════════════════════════════════
  🤖 WORKER AGENT v4 STARTING
═══════════════════════════════════════════════════════
  Wallet:   ${this.contract.wallet.address}
  Balance:  ${ethers.formatEther(balance)} MON
  Interval: ${this.scanInterval / 1000}s
  Min Pay:  ${this.minPayment} MON
  Max Jobs: ${this.maxConcurrentJobs}
═══════════════════════════════════════════════════════
`);

        await this.scanAndProcess();
        this.intervalId = setInterval(() => this.scanAndProcess(), this.scanInterval);
    }

    async stop() {
        console.log('\n🛑 Worker agent stopping…');
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async scanAndProcess() {
        if (!this.isRunning) return;

        // Don't scan if at capacity
        if (this.activeJobs.length >= this.maxConcurrentJobs) {
            console.log(`   ⏸ At capacity (${this.activeJobs.length}/${this.maxConcurrentJobs}), skipping scan`);
            return;
        }

        try {
            console.log('\n🔍 Scanning for jobs…');
            const jobs = await this.contract.getOpenJobs(20);

            const suitableJobs = jobs.filter(job =>
                parseFloat(job.payment) >= this.minPayment &&
                !this.activeJobs.includes(job.id) &&
                !this.failedJobs.has(job.id)
            );

            console.log(`   Found ${jobs.length} open, ${suitableJobs.length} suitable`);

            for (const job of suitableJobs) {
                if (!this.isRunning) break;
                if (this.activeJobs.length >= this.maxConcurrentJobs) break;

                const evaluation = await this.evaluateJob(job);

                console.log(`\n📋 Job #${job.id}: "${job.description.substring(0, 50)}…"`);
                console.log(`   Can do: ${evaluation.canDo} | Confidence: ${evaluation.confidence}% | ${evaluation.reason}`);

                if (evaluation.canDo && evaluation.confidence >= 70) {
                    await this.processJob(job);
                }
            }
        } catch (error) {
            console.error('Scan error:', error.message);
        }
    }

    async evaluateJob(job) {
        return await this.aiService.evaluateJob(job);
    }

    async processJob(job) {
        try {
            console.log(`\n🎯 Claiming job #${job.id}…`);
            const claimed = await this.claimJob(job);
            if (!claimed) return;

            this.activeJobs.push(job.id);

            // Set a processing timeout (5 minutes)
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Processing timeout (5min)')), 300_000)
            );

            console.log(`\n⚙️ Working on job #${job.id}…`);
            const result = await Promise.race([
                this.doWork(job),
                timeout
            ]);

            console.log(`\n📤 Submitting result for job #${job.id}…`);
            await this.submitResult(job.id, result);

            this.activeJobs = this.activeJobs.filter(id => id !== job.id);

        } catch (error) {
            console.error(`❌ Job #${job.id} failed:`, error.message);
            this.activeJobs = this.activeJobs.filter(id => id !== job.id);
            this.failedJobs.add(job.id);

            // Clear failed job from blocklist after 10 minutes (allow retry)
            setTimeout(() => this.failedJobs.delete(job.id), 600_000);
        }
    }

    async claimJob(job) {
        try {
            console.log(`   Stake required: ${job.stakeRequired} MON`);
            const result = await this.contract.claimJob(job.id);
            console.log(`   ✅ Claimed! TX: ${result.txHash || result}`);
            this.emit('jobClaimed', {
                jobId: job.id,
                worker: this.contract.wallet.address,
                txHash: result.txHash || ''
            });
            return true;
        } catch (error) {
            console.log(`   ❌ Claim failed: ${error.message}`);
            return false;
        }
    }

    async doWork(job) {
        console.log(`🤖 Processing job #${job.id} with AI…`);
        const result = await this.aiService.processJob(job);
        console.log(`   ✅ Work completed for job #${job.id}`);
        return result;
    }

    async submitResult(jobId, result) {
        try {
            const txResult = await this.contract.submitResult(jobId, result);
            console.log(`   ✅ Submitted! TX: ${txResult.txHash || txResult}`);
            this.emit('jobSubmitted', { jobId, txHash: txResult.txHash || '' });
        } catch (error) {
            console.error(`   ❌ Submit failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = WorkerAgent;
