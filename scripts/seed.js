/**
 * Seed Script - Agent Jobs Protocol
 * 
 * Posts demo jobs so hackathon judges can see the protocol in action.
 * Run with: node scripts/seed.js
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Job categories
const CATEGORIES = {
    RESEARCH: 0,
    ANALYSIS: 1,
    MONITORING: 2,
    CONTENT: 3,
    DATA: 4,
    OTHER: 5
};

// Demo jobs to post
const DEMO_JOBS = [
    {
        description: "Research the top 5 DeFi protocols on Monad blockchain and summarize their key features, TVL, and unique selling points",
        category: CATEGORIES.RESEARCH,
        payment: 0.1,
        deadline: 24
    },
    {
        description: "Analyze the wallet activity of address 0x742d35Cc6634C0532925a3b844Bc9e7595f2bd73 and provide insights on trading patterns",
        category: CATEGORIES.ANALYSIS,
        payment: 0.15,
        deadline: 12
    },
    {
        description: "Create a Twitter thread (5-7 tweets) explaining what Agent Jobs Protocol is and why it matters for the future of AI agents on blockchain",
        category: CATEGORIES.CONTENT,
        payment: 0.08,
        deadline: 6
    },
    {
        description: "Fetch and compile data on the top 10 tokens by trading volume on Monad DEXs in the past 24 hours. Return as JSON.",
        category: CATEGORIES.DATA,
        payment: 0.12,
        deadline: 8
    },
    {
        description: "Compare Monad's transaction throughput and fees with Ethereum, Solana, and Avalanche. Provide a detailed comparison table.",
        category: CATEGORIES.RESEARCH,
        payment: 0.1,
        deadline: 24
    },
    {
        description: "Write a beginner's guide to using the Agent Jobs Protocol - how to post jobs, how agents claim and complete work, and how payments work",
        category: CATEGORIES.CONTENT,
        payment: 0.1,
        deadline: 12
    }
];

async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  🌱 AGENT JOBS - SEED SCRIPT');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Check env vars
    if (!process.env.RPC_URL || !process.env.CONTRACT_ADDRESS || !process.env.WORKER_PRIVATE_KEY) {
        console.error('❌ Missing required environment variables!');
        console.error('   Required: RPC_URL, CONTRACT_ADDRESS, WORKER_PRIVATE_KEY');
        process.exit(1);
    }
    
    // Connect to network
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.WORKER_PRIVATE_KEY, provider);
    
    console.log(`📋 Contract: ${process.env.CONTRACT_ADDRESS}`);
    console.log(`👛 Wallet: ${wallet.address}`);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = ethers.formatEther(balance);
    console.log(`💰 Balance: ${balanceETH} MON\n`);
    
    // Calculate total payment needed
    const totalPayment = DEMO_JOBS.reduce((sum, job) => sum + job.payment, 0);
    console.log(`📊 Jobs to post: ${DEMO_JOBS.length}`);
    console.log(`💸 Total payment needed: ${totalPayment} MON\n`);
    
    if (parseFloat(balanceETH) < totalPayment + 0.1) {
        console.error(`❌ Insufficient balance!`);
        console.error(`   Need at least ${totalPayment + 0.1} MON`);
        console.error(`   You have ${balanceETH} MON`);
        process.exit(1);
    }
    
    // Load contract ABI
    const abiPath = path.join(__dirname, '../contracts/AgentJobs.abi.json');
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
    
    // Post each job
    console.log('📝 Posting demo jobs...\n');
    const postedJobs = [];
    
    for (let i = 0; i < DEMO_JOBS.length; i++) {
        const job = DEMO_JOBS[i];
        
        console.log(`[${i + 1}/${DEMO_JOBS.length}] Posting: "${job.description.substring(0, 50)}..."`);
        
        try {
            const paymentWei = ethers.parseEther(job.payment.toString());
            
            const tx = await contract.postJob(
                job.description,
                job.category,
                job.deadline,
                { value: paymentWei }
            );
            
            console.log(`   TX: ${tx.hash}`);
            const receipt = await tx.wait();
            
            // Get job ID from event
            const event = receipt.logs.find(log => {
                try {
                    const parsed = contract.interface.parseLog(log);
                    return parsed.name === 'JobPosted';
                } catch {
                    return false;
                }
            });
            
            if (event) {
                const parsed = contract.interface.parseLog(event);
                const jobId = Number(parsed.args.jobId);
                console.log(`   ✅ Job #${jobId} posted!\n`);
                postedJobs.push(jobId);
            }
            
            // Small delay between transactions
            await new Promise(r => setTimeout(r, 1000));
            
        } catch (error) {
            console.error(`   ❌ Failed: ${error.message}\n`);
        }
    }
    
    // Summary
    console.log('═══════════════════════════════════════════════════════');
    console.log('  ✅ SEEDING COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Jobs posted: ${postedJobs.length}/${DEMO_JOBS.length}`);
    console.log(`  Job IDs: ${postedJobs.join(', ')}`);
    
    // Get final stats
    try {
        const jobCounter = await contract.jobCounter();
        const newBalance = await provider.getBalance(wallet.address);
        console.log(`\n  Total jobs on protocol: ${jobCounter}`);
        console.log(`  Remaining balance: ${ethers.formatEther(newBalance)} MON`);
    } catch (e) {}
    
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('🎯 Next steps:');
    console.log('   1. Run the server: npm run server');
    console.log('   2. Open dashboard: http://localhost:3000');
    console.log('   3. Start worker agent to process jobs');
    console.log('');
}

main().catch(console.error);
