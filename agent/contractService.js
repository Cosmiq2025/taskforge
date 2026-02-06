/**
 * Contract Service v4
 * 
 * Improvements:
 * - Gas estimation with fallback
 * - Better error messages
 * - Retry for transient RPC errors
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

class ContractService {
    constructor(privateKey, rpcUrl, contractAddress) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);

        const abiPath = path.join(__dirname, '../contracts/AgentJobs.abi.json');
        if (!fs.existsSync(abiPath)) {
            throw new Error(`ABI file not found: ${abiPath}`);
        }
        this.abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

        this.contract = new ethers.Contract(contractAddress, this.abi, this.wallet);
        this.address = this.wallet.address;
    }

    // ─── Retry Helper ────────────────────────────

    async withRetry(fn, retries = 2, delay = 2000) {
        for (let i = 0; i <= retries; i++) {
            try {
                return await fn();
            } catch (error) {
                const isTransient = error.code === 'NETWORK_ERROR' ||
                                    error.code === 'SERVER_ERROR' ||
                                    error.code === 'TIMEOUT' ||
                                    error.message?.includes('rate limit');
                if (i === retries || !isTransient) throw error;
                console.log(`   ⏳ Retry ${i + 1}/${retries} after ${delay}ms…`);
                await new Promise(r => setTimeout(r, delay * (i + 1)));
            }
        }
    }

    // ─── Job Posting ─────────────────────────────

    async postJob(description, category, deadlineHours, paymentMON) {
        console.log(`📝 Posting job: "${description.substring(0, 50)}…"`);
        console.log(`   Category: ${this.getCategoryName(category)} | Payment: ${paymentMON} MON | Deadline: ${deadlineHours}h`);

        const paymentWei = ethers.parseEther(paymentMON.toString());

        const tx = await this.contract.postJob(description, category, deadlineHours, {
            value: paymentWei,
            gasLimit: 1_000_000
        });

        console.log(`   TX: ${tx.hash}`);
        const receipt = await tx.wait();

        const event = receipt.logs.find(log => {
            try { return this.contract.interface.parseLog(log)?.name === 'JobPosted'; }
            catch { return false; }
        });

        if (event) {
            const parsed = this.contract.interface.parseLog(event);
            const jobId = parsed.args.jobId;
            console.log(`✅ Job posted! ID: ${jobId}`);
            return jobId;
        }

        return null;
    }

    // ─── Job Claiming ────────────────────────────

    async claimJob(jobId) {
        console.log(`🎯 Claiming job #${jobId}…`);

        const payment = await this.withRetry(() => this.contract.getJobPayment(jobId));
        const stakeRequired = payment.stakeRequired;
        console.log(`   Stake: ${ethers.formatEther(stakeRequired)} MON`);

        const tx = await this.contract.claimJob(jobId, {
            value: stakeRequired,
            gasLimit: 500_000
        });
        console.log(`   TX: ${tx.hash}`);
        await tx.wait();
        console.log(`✅ Job #${jobId} claimed!`);

        return { txHash: tx.hash };
    }

    // ─── Result Submission ───────────────────────

    async submitResult(jobId, resultHash) {
        console.log(`📤 Submitting result for job #${jobId}…`);

        // Truncate result if too long for on-chain storage
        const maxLen = 10_000;
        const truncated = typeof resultHash === 'string' && resultHash.length > maxLen
            ? resultHash.substring(0, maxLen) + '\n\n[Result truncated for on-chain storage]'
            : resultHash;

        const tx = await this.contract.submitResult(jobId, truncated, {
            gasLimit: 2_000_000
        });
        console.log(`   TX: ${tx.hash}`);
        await tx.wait();
        console.log(`✅ Result submitted for job #${jobId}!`);

        return { txHash: tx.hash };
    }

    // ─── Approval ────────────────────────────────

    async approveResult(jobId) {
        console.log(`👍 Approving job #${jobId}…`);
        const tx = await this.contract.approveResult(jobId, { gasLimit: 500_000 });
        console.log(`   TX: ${tx.hash}`);
        await tx.wait();
        console.log(`✅ Job #${jobId} approved!`);
        return { txHash: tx.hash };
    }

    // ─── Queries ─────────────────────────────────

    async getJob(jobId) {
        return this.withRetry(async () => {
            const [core, payment, timing, description, result] = await Promise.all([
                this.contract.getJobCore(jobId),
                this.contract.getJobPayment(jobId),
                this.contract.getJobTiming(jobId),
                this.contract.getJobDescription(jobId),
                this.contract.getJobResult(jobId)
            ]);

            return {
                id: Number(core.id),
                client: core.client,
                worker: core.worker,
                category: Number(core.category),
                categoryName: this.getCategoryName(Number(core.category)),
                status: Number(core.status),
                statusName: this.getStatusName(Number(core.status)),
                payment: ethers.formatEther(payment.payment),
                stakeRequired: ethers.formatEther(payment.stakeRequired),
                workerStake: ethers.formatEther(payment.workerStake),
                createdAt: new Date(Number(timing.createdAt) * 1000),
                deadline: new Date(Number(timing.deadline) * 1000),
                submittedAt: timing.submittedAt > 0 ? new Date(Number(timing.submittedAt) * 1000) : null,
                description: description,
                resultHash: result
            };
        });
    }

    async getOpenJobs(limit = 20) {
        const jobCount = await this.getJobCounter();
        const jobs = [];

        for (let i = jobCount; i >= 1 && jobs.length < limit; i--) {
            try {
                const isOpen = await this.contract.isJobOpen(i);
                if (isOpen) {
                    const job = await this.getJob(i);
                    jobs.push(job);
                }
            } catch (_) { /* skip */ }
        }

        return jobs;
    }

    async getAgentStats(address) {
        const stats = await this.withRetry(() => this.contract.getAgentStats(address || this.address));
        return {
            jobsPosted: Number(stats.jobsPosted),
            jobsCompleted: Number(stats.jobsCompleted),
            jobsFailed: Number(stats.jobsFailed),
            totalEarned: ethers.formatEther(stats.totalEarned),
            totalSpent: ethers.formatEther(stats.totalSpent),
            reputation: Number(stats.reputation) / 10
        };
    }

    async getJobCounter() {
        return Number(await this.withRetry(() => this.contract.jobCounter()));
    }

    async getTotalPayouts() {
        return ethers.formatEther(await this.withRetry(() => this.contract.totalPayouts()));
    }

    async getBalance() {
        const balance = await this.provider.getBalance(this.address);
        return ethers.formatEther(balance);
    }

    // ─── Event Listening ─────────────────────────

    onJobPosted(cb) {
        this.contract.on('JobPosted', (jobId, client, payment, deadline) => {
            cb({ jobId: Number(jobId), client, payment: ethers.formatEther(payment), deadline: Number(deadline) });
        });
    }

    onJobClaimed(cb) {
        this.contract.on('JobClaimed', (jobId, worker, stake) => {
            cb({ jobId: Number(jobId), worker, stake: ethers.formatEther(stake) });
        });
    }

    onJobSubmitted(cb) {
        this.contract.on('JobSubmitted', (jobId, worker) => {
            cb({ jobId: Number(jobId), worker });
        });
    }

    onJobCompleted(cb) {
        this.contract.on('JobCompleted', (jobId, worker, payout) => {
            cb({ jobId: Number(jobId), worker, payout: ethers.formatEther(payout) });
        });
    }

    // ─── Helpers ─────────────────────────────────

    getCategoryName(category) {
        return ['Research', 'Analysis', 'Monitoring', 'Content', 'Data', 'Other'][category] || 'Unknown';
    }

    getStatusName(status) {
        return ['Open', 'Claimed', 'Submitted', 'Completed', 'Disputed', 'Cancelled', 'Expired'][status] || 'Unknown';
    }
}

module.exports = ContractService;
