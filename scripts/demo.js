/**
 * Demo Script
 * Demonstrates the full Agent Jobs flow
 * 
 * Run: node scripts/demo.js
 */

require('dotenv').config();
const ContractService = require('../agent/contractService');
const AIService = require('../agent/aiService');

const DEMO_JOBS = [
    {
        description: "Research the top 5 most promising DeFi protocols currently building on Monad. Include TVL, unique features, and team background.",
        category: 0, // Research
        payment: 0.1,
        deadline: 2
    },
    {
        description: "Analyze the trading patterns of early Monad adopters. What tokens are they accumulating? What's the average hold time?",
        category: 1, // Analysis
        payment: 0.15,
        deadline: 4
    },
    {
        description: "Write a compelling Twitter thread (5-7 tweets) explaining why AI agents on blockchain are the future. Make it engaging and informative.",
        category: 3, // Content
        payment: 0.08,
        deadline: 2
    }
];

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  🎬 AGENT JOBS PROTOCOL - DEMO');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Check env
    if (!process.env.CONTRACT_ADDRESS || !process.env.WORKER_PRIVATE_KEY) {
        console.error('❌ Please configure .env first');
        console.error('   Required: CONTRACT_ADDRESS, WORKER_PRIVATE_KEY, OPENAI_API_KEY');
        process.exit(1);
    }
    
    // Initialize services
    const contract = new ContractService(
        process.env.WORKER_PRIVATE_KEY,
        process.env.RPC_URL,
        process.env.CONTRACT_ADDRESS
    );
    
    const ai = new AIService(process.env.OPENAI_API_KEY);
    
    console.log(`📍 Contract: ${process.env.CONTRACT_ADDRESS}`);
    console.log(`💰 Agent wallet: ${contract.address}`);
    console.log(`💵 Balance: ${await contract.getBalance()} MON\n`);
    
    // Demo flow
    const args = process.argv.slice(2);
    const mode = args[0] || 'full';
    
    switch (mode) {
        case 'post':
            await demoPostJobs(contract);
            break;
        case 'list':
            await demoListJobs(contract);
            break;
        case 'work':
            await demoWorkOnJob(contract, ai, parseInt(args[1]) || 1);
            break;
        case 'full':
            await demoFullFlow(contract, ai);
            break;
        default:
            console.log(`
Usage:
  node scripts/demo.js post     - Post sample jobs
  node scripts/demo.js list     - List open jobs
  node scripts/demo.js work [id] - Work on a specific job
  node scripts/demo.js full     - Full demo (post + work)
            `);
    }
}

async function demoPostJobs(contract) {
    console.log('📝 POSTING DEMO JOBS\n');
    
    for (const job of DEMO_JOBS) {
        console.log(`Posting: "${job.description.substring(0, 50)}..."`);
        
        try {
            const jobId = await contract.postJob(
                job.description,
                job.category,
                job.deadline,
                job.payment
            );
            console.log(`✅ Posted as Job #${jobId}\n`);
        } catch (error) {
            console.error(`❌ Failed: ${error.message}\n`);
        }
        
        await sleep(2000);
    }
    
    console.log('Done posting jobs!');
}

async function demoListJobs(contract) {
    console.log('📋 OPEN JOBS\n');
    
    const jobs = await contract.getOpenJobs(10, 0);
    
    if (jobs.length === 0) {
        console.log('No open jobs. Run: node scripts/demo.js post');
        return;
    }
    
    for (const job of jobs) {
        console.log(`#${job.id} [${job.categoryName}] ${job.payment} MON`);
        console.log(`   ${job.description.substring(0, 60)}...`);
        console.log(`   Deadline: ${job.deadline.toLocaleString()}\n`);
    }
}

async function demoWorkOnJob(contract, ai, jobId) {
    console.log(`⚙️ WORKING ON JOB #${jobId}\n`);
    
    // Get job
    const job = await contract.getJob(jobId);
    
    if (job.status !== 0) {
        console.log(`❌ Job #${jobId} is not open (status: ${job.statusName})`);
        return;
    }
    
    console.log(`Job: ${job.description}\n`);
    
    // Evaluate
    console.log('🤔 Evaluating if we can do this...');
    const evaluation = await ai.canDoJob(job);
    console.log(`   Can do: ${evaluation.canDo}`);
    console.log(`   Confidence: ${evaluation.confidence}%`);
    console.log(`   Reason: ${evaluation.reason}\n`);
    
    if (!evaluation.canDo || evaluation.confidence < 50) {
        console.log('❌ Not confident enough to take this job');
        return;
    }
    
    // Claim
    console.log('🎯 Claiming job...');
    await contract.claimJob(jobId);
    console.log('✅ Job claimed!\n');
    
    // Do work
    console.log('🤖 AI working on the job...');
    const workResult = await ai.doJob(job);
    
    if (!workResult.success) {
        console.error('❌ Failed to complete work:', workResult.error);
        return;
    }
    
    console.log('✅ Work completed!\n');
    console.log('─'.repeat(60));
    console.log('RESULT:');
    console.log('─'.repeat(60));
    console.log(workResult.result);
    console.log('─'.repeat(60) + '\n');
    
    // Submit
    console.log('📤 Submitting result...');
    await contract.submitResult(jobId, workResult.result);
    console.log('✅ Result submitted!\n');
    
    console.log('🎉 Job complete! Waiting for client approval...');
    console.log('   (In production, the client agent would auto-verify this)');
}

async function demoFullFlow(contract, ai) {
    console.log('🎬 FULL DEMO FLOW\n');
    
    // Step 1: Post a job
    console.log('═══════════════════════════════════════');
    console.log('STEP 1: POST A JOB');
    console.log('═══════════════════════════════════════\n');
    
    const testJob = {
        description: "Research and summarize the current state of AI agents on blockchain. What are the main projects? What problems are they solving? What's the future potential?",
        category: 0,
        payment: 0.1,
        deadline: 2
    };
    
    console.log(`Posting: "${testJob.description.substring(0, 50)}..."`);
    const jobId = await contract.postJob(
        testJob.description,
        testJob.category,
        testJob.deadline,
        testJob.payment
    );
    console.log(`✅ Posted as Job #${jobId}\n`);
    
    await sleep(3000);
    
    // Step 2: Claim the job
    console.log('═══════════════════════════════════════');
    console.log('STEP 2: WORKER AGENT CLAIMS JOB');
    console.log('═══════════════════════════════════════\n');
    
    const job = await contract.getJob(Number(jobId));
    
    console.log('🤔 Evaluating job...');
    const evaluation = await ai.canDoJob(job);
    console.log(`   Confidence: ${evaluation.confidence}%\n`);
    
    console.log('🎯 Claiming...');
    await contract.claimJob(Number(jobId));
    console.log('✅ Claimed!\n');
    
    await sleep(2000);
    
    // Step 3: Do the work
    console.log('═══════════════════════════════════════');
    console.log('STEP 3: AI DOES THE WORK');
    console.log('═══════════════════════════════════════\n');
    
    console.log('🤖 Working...\n');
    const workResult = await ai.doJob(job);
    
    console.log('─'.repeat(60));
    console.log('AI GENERATED RESULT:');
    console.log('─'.repeat(60));
    console.log(workResult.result.substring(0, 1000) + '...');
    console.log('─'.repeat(60) + '\n');
    
    // Step 4: Submit result
    console.log('═══════════════════════════════════════');
    console.log('STEP 4: SUBMIT RESULT ON-CHAIN');
    console.log('═══════════════════════════════════════\n');
    
    console.log('📤 Submitting...');
    await contract.submitResult(Number(jobId), workResult.result);
    console.log('✅ Submitted!\n');
    
    // Step 5: Approve (in real scenario, different agent)
    console.log('═══════════════════════════════════════');
    console.log('STEP 5: CLIENT APPROVES & PAYS');
    console.log('═══════════════════════════════════════\n');
    
    console.log('👍 Approving result...');
    await contract.approveResult(Number(jobId));
    console.log('✅ Approved! Payment released!\n');
    
    // Final stats
    console.log('═══════════════════════════════════════');
    console.log('🎉 DEMO COMPLETE');
    console.log('═══════════════════════════════════════\n');
    
    const stats = await contract.getAgentStats();
    console.log('Agent Stats:');
    console.log(`   Jobs Completed: ${stats.jobsCompleted}`);
    console.log(`   Total Earned: ${stats.totalEarned} MON`);
    console.log(`   Reputation: ${stats.reputation}%`);
    
    const balance = await contract.getBalance();
    console.log(`\nFinal Balance: ${balance} MON`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
