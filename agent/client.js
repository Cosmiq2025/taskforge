/**
 * Client Agent - Agent Jobs Protocol
 * Posts jobs to the marketplace and manages them
 * 
 * Uses WORKER_PRIVATE_KEY by default (CLIENT_PRIVATE_KEY is optional)
 */

require('dotenv').config();
const ContractService = require('./contractService');
const AIService = require('./aiService');

// Job categories
const CATEGORIES = {
    RESEARCH: 0,
    ANALYSIS: 1,
    MONITORING: 2,
    CONTENT: 3,
    DATA: 4,
    OTHER: 5
};

class ClientAgent {
    constructor() {
        // Use WORKER_PRIVATE_KEY by default (CLIENT_PRIVATE_KEY is optional)
        const privateKey = process.env.WORKER_PRIVATE_KEY;
        
        if (!privateKey) {
            throw new Error('Missing WORKER_PRIVATE_KEY in .env file');
        }
        
        this.contract = new ContractService(
            privateKey,
            process.env.RPC_URL,
            process.env.CONTRACT_ADDRESS
        );
        
        this.ai = new AIService(process.env.OPENAI_API_KEY);
        this.postedJobs = [];
    }
    
    async init() {
        console.log('═══════════════════════════════════════════════════════');
        console.log('  📋 CLIENT AGENT READY');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`  Wallet: ${this.contract.address}`);
        console.log(`  Balance: ${await this.contract.getBalance()} MON`);
        console.log('═══════════════════════════════════════════════════════\n');
        
        // Set up event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Listen for our jobs being claimed
        this.contract.onJobClaimed((event) => {
            const myJob = this.postedJobs.find(j => j.id === event.jobId);
            if (myJob) {
                console.log(`\n🎯 Job #${event.jobId} claimed by ${event.worker.substring(0, 10)}...`);
            }
        });
        
        // Listen for results
        this.contract.onJobSubmitted((event) => {
            const myJob = this.postedJobs.find(j => j.id === event.jobId);
            if (myJob) {
                console.log(`\n📥 Result submitted for job #${event.jobId}!`);
            }
        });
    }
    
    /**
     * Post a job to the marketplace
     */
    async postJob(description, category = CATEGORIES.OTHER, deadlineHours = 24, paymentMON = 0.1) {
        console.log('\n📝 Posting new job...');
        
        const jobId = await this.contract.postJob(
            description,
            category,
            deadlineHours,
            paymentMON
        );
        
        if (jobId) {
            this.postedJobs.push({
                id: Number(jobId),
                description,
                category,
                payment: paymentMON,
                postedAt: new Date()
            });
        }
        
        return jobId;
    }
    
    /**
     * Post a research job
     */
    async requestResearch(topic, paymentMON = 0.1, deadlineHours = 24) {
        const description = `Research the following topic and provide a comprehensive summary with key findings: ${topic}`;
        return this.postJob(description, CATEGORIES.RESEARCH, deadlineHours, paymentMON);
    }
    
    /**
     * Post an analysis job
     */
    async requestAnalysis(subject, paymentMON = 0.15, deadlineHours = 24) {
        const description = `Analyze the following and provide insights, patterns, and recommendations: ${subject}`;
        return this.postJob(description, CATEGORIES.ANALYSIS, deadlineHours, paymentMON);
    }
    
    /**
     * Post a content creation job
     */
    async requestContent(contentType, details, paymentMON = 0.1, deadlineHours = 24) {
        const description = `Create ${contentType} content: ${details}`;
        return this.postJob(description, CATEGORIES.CONTENT, deadlineHours, paymentMON);
    }
    
    /**
     * Post a data job
     */
    async requestData(dataRequest, paymentMON = 0.1, deadlineHours = 12) {
        const description = `Fetch and organize the following data: ${dataRequest}`;
        return this.postJob(description, CATEGORIES.DATA, deadlineHours, paymentMON);
    }
    
    /**
     * Check status of a job
     */
    async checkJob(jobId) {
        const job = await this.contract.getJob(jobId);
        console.log(`\n📊 Job #${jobId} Status:`);
        console.log(`   Status: ${job.statusName}`);
        console.log(`   Description: ${job.description.substring(0, 50)}...`);
        
        if (job.worker !== '0x0000000000000000000000000000000000000000') {
            console.log(`   Worker: ${job.worker}`);
        }
        
        if (job.resultHash) {
            console.log(`   Result: ${job.resultHash.substring(0, 100)}...`);
        }
        
        return job;
    }
    
    /**
     * Approve a submitted result
     */
    async approveJob(jobId, autoVerify = true) {
        const job = await this.contract.getJob(jobId);
        
        if (job.status !== 2) { // 2 = Submitted
            console.log(`❌ Job #${jobId} is not in submitted status`);
            return false;
        }
        
        if (autoVerify) {
            console.log('\n🔍 AI verifying result...');
            const verification = await this.ai.verifyResult(job, job.resultHash);
            
            console.log(`   Quality: ${verification.quality}%`);
            console.log(`   Feedback: ${verification.feedback}`);
            
            if (!verification.approved) {
                console.log('   ⚠️ AI recommends disputing this result');
                return false;
            }
        }
        
        await this.contract.approveResult(jobId);
        return true;
    }
    
    /**
     * Dispute a result
     */
    async disputeJob(jobId) {
        console.log(`\n⚠️ Disputing job #${jobId}...`);
        
        const tx = await this.contract.contract.disputeResult(jobId);
        await tx.wait();
        
        console.log(`✅ Job #${jobId} disputed`);
        return true;
    }
    
    /**
     * Cancel an unclaimed job
     */
    async cancelJob(jobId) {
        const job = await this.contract.getJob(jobId);
        
        if (job.status !== 0) {
            console.log(`❌ Job #${jobId} cannot be cancelled (already claimed)`);
            return false;
        }
        
        console.log(`\n🗑️ Cancelling job #${jobId}...`);
        
        const tx = await this.contract.contract.cancelJob(jobId);
        await tx.wait();
        
        console.log(`✅ Job #${jobId} cancelled, payment refunded`);
        return true;
    }
    
    /**
     * Get all my posted jobs
     */
    async getMyJobs() {
        const jobIds = await this.contract.contract.getAgentPostedJobs(this.contract.address);
        const jobs = [];
        
        for (const id of jobIds) {
            jobs.push(await this.contract.getJob(Number(id)));
        }
        
        return jobs;
    }
    
    /**
     * Get my stats
     */
    async getStats() {
        return this.contract.getAgentStats();
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const client = new ClientAgent();
    await client.init();
    
    const command = args[0];
    
    switch (command) {
        case 'research':
            await client.requestResearch(
                args[1] || 'Top 5 DeFi protocols on Monad',
                parseFloat(args[2]) || 0.1,
                parseInt(args[3]) || 24
            );
            break;
            
        case 'analyze':
            await client.requestAnalysis(
                args[1] || 'Monad blockchain performance vs Ethereum',
                parseFloat(args[2]) || 0.15,
                parseInt(args[3]) || 24
            );
            break;
            
        case 'content':
            await client.requestContent(
                args[1] || 'Twitter thread',
                args[2] || 'About the future of AI agents on blockchain',
                parseFloat(args[3]) || 0.1,
                parseInt(args[4]) || 24
            );
            break;
            
        case 'status':
            await client.checkJob(parseInt(args[1]) || 1);
            break;
            
        case 'approve':
            await client.approveJob(parseInt(args[1]) || 1);
            break;
            
        case 'myjobs':
            const jobs = await client.getMyJobs();
            console.log('\n📋 My Posted Jobs:');
            jobs.forEach(j => {
                console.log(`   #${j.id} [${j.statusName}] ${j.description.substring(0, 40)}...`);
            });
            break;
            
        case 'stats':
            const stats = await client.getStats();
            console.log('\n📊 My Stats:');
            console.log(`   Jobs Posted: ${stats.jobsPosted}`);
            console.log(`   Total Spent: ${stats.totalSpent} MON`);
            break;
            
        default:
            console.log(`
Usage:
  node client.js research "topic" [payment] [hours]
  node client.js analyze "subject" [payment] [hours]  
  node client.js content "type" "details" [payment] [hours]
  node client.js status [jobId]
  node client.js approve [jobId]
  node client.js myjobs
  node client.js stats
            `);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ClientAgent;
