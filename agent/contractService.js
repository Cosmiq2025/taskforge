/**
 * Contract Service
 * Handles all blockchain interactions for the Agent Jobs Protocol
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

class ContractService {
    constructor(privateKey, rpcUrl, contractAddress) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        
        const abiPath = path.join(__dirname, '../contracts/AgentJobs.abi.json');
        this.abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
        
        this.contract = new ethers.Contract(contractAddress, this.abi, this.wallet);
        this.address = this.wallet.address;
    }
    
    // ============ Job Posting ============
    
    async postJob(description, category, deadlineHours, paymentMON) {
        console.log(`📝 Posting job: "${description.substring(0, 50)}..."`);
        console.log(`   Category: ${this.getCategoryName(category)}`);
        console.log(`   Payment: ${paymentMON} MON`);
        console.log(`   Deadline: ${deadlineHours} hours`);
        
        const paymentWei = ethers.parseEther(paymentMON.toString());
        
        const tx = await this.contract.postJob(
            description,
            category,
            deadlineHours,
            { value: paymentWei }
        );
        
        console.log(`   TX: ${tx.hash}`);
        const receipt = await tx.wait();
        
        // Get job ID from event
        const event = receipt.logs.find(log => {
            try {
                const parsed = this.contract.interface.parseLog(log);
                return parsed.name === 'JobPosted';
            } catch {
                return false;
            }
        });
        
        if (event) {
            const parsed = this.contract.interface.parseLog(event);
            const jobId = parsed.args.jobId;
            console.log(`✅ Job posted! ID: ${jobId}`);
            return jobId;
        }
        
        return null;
    }
    
    // ============ Job Claiming ============
    
    async claimJob(jobId) {
        console.log(`🎯 Claiming job #${jobId}...`);
        
        const payment = await this.contract.getJobPayment(jobId);
        const stakeRequired = payment.stakeRequired;
        
        console.log(`   Stake required: ${ethers.formatEther(stakeRequired)} MON`);
        
        const tx = await this.contract.claimJob(jobId, { value: stakeRequired });
        console.log(`   TX: ${tx.hash}`);
        
        await tx.wait();
        console.log(`✅ Job #${jobId} claimed!`);
        
        return true;
    }
    
    // ============ Result Submission ============
    
    async submitResult(jobId, resultHash) {
        console.log(`📤 Submitting result for job #${jobId}...`);
        console.log(`   Result: ${resultHash.substring(0, 100)}...`);
        
        const tx = await this.contract.submitResult(jobId, resultHash);
        console.log(`   TX: ${tx.hash}`);
        
        await tx.wait();
        console.log(`✅ Result submitted for job #${jobId}!`);
        
        return true;
    }
    
    // ============ Approval ============
    
    async approveResult(jobId) {
        console.log(`👍 Approving job #${jobId}...`);
        
        const tx = await this.contract.approveResult(jobId);
        console.log(`   TX: ${tx.hash}`);
        
        await tx.wait();
        console.log(`✅ Job #${jobId} approved and paid!`);
        
        return true;
    }
    
    // ============ Queries ============
    
    async getJob(jobId) {
        // Fetch from multiple view functions and combine
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
    }
    
    async getOpenJobs(limit = 20) {
        const jobCount = await this.getJobCounter();
        const jobs = [];
        
        // Iterate backwards to get newest first
        for (let i = jobCount; i >= 1 && jobs.length < limit; i--) {
            try {
                const isOpen = await this.contract.isJobOpen(i);
                if (isOpen) {
                    const job = await this.getJob(i);
                    jobs.push(job);
                }
            } catch (e) {
                // Skip invalid jobs
            }
        }
        
        return jobs;
    }
    
    async getAgentStats(address) {
        const stats = await this.contract.getAgentStats(address || this.address);
        return {
            jobsPosted: Number(stats.jobsPosted),
            jobsCompleted: Number(stats.jobsCompleted),
            jobsFailed: Number(stats.jobsFailed),
            totalEarned: ethers.formatEther(stats.totalEarned),
            totalSpent: ethers.formatEther(stats.totalSpent),
            reputation: Number(stats.reputation) / 10 // Convert to percentage
        };
    }
    
    async getJobCounter() {
        return Number(await this.contract.jobCounter());
    }
    
    async getTotalPayouts() {
        return ethers.formatEther(await this.contract.totalPayouts());
    }
    
    async getBalance() {
        const balance = await this.provider.getBalance(this.address);
        return ethers.formatEther(balance);
    }
    
    async getAgentPostedJobs(address) {
        return await this.contract.getAgentPostedJobs(address || this.address);
    }
    
    async getAgentClaimedJobs(address) {
        return await this.contract.getAgentClaimedJobs(address || this.address);
    }
    
    // ============ Event Listening ============
    
    onJobPosted(callback) {
        this.contract.on('JobPosted', (jobId, client, payment, deadline) => {
            callback({
                jobId: Number(jobId),
                client,
                payment: ethers.formatEther(payment),
                deadline: Number(deadline)
            });
        });
    }
    
    onJobClaimed(callback) {
        this.contract.on('JobClaimed', (jobId, worker, stake) => {
            callback({
                jobId: Number(jobId),
                worker,
                stake: ethers.formatEther(stake)
            });
        });
    }
    
    onJobSubmitted(callback) {
        this.contract.on('JobSubmitted', (jobId, worker) => {
            callback({
                jobId: Number(jobId),
                worker
            });
        });
    }
    
    onJobCompleted(callback) {
        this.contract.on('JobCompleted', (jobId, worker, payout) => {
            callback({
                jobId: Number(jobId),
                worker,
                payout: ethers.formatEther(payout)
            });
        });
    }
    
    // ============ Helpers ============
    
    getCategoryName(category) {
        const categories = ['Research', 'Analysis', 'Monitoring', 'Content', 'Data', 'Other'];
        return categories[category] || 'Unknown';
    }
    
    getStatusName(status) {
        const statuses = ['Open', 'Claimed', 'Submitted', 'Completed', 'Disputed', 'Cancelled', 'Expired'];
        return statuses[status] || 'Unknown';
    }
}

module.exports = ContractService;
