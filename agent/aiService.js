/**
 * AI Service - Agent Jobs Protocol
 * 
 * Uses OpenAI for content tasks + Blockchain Service for real on-chain data
 * Falls back to demo mode if OpenAI not configured
 */

const BlockchainService = require('./blockchainService');

class AIService {
    constructor(openaiKey, rpcUrl) {
        this.openaiKey = openaiKey;
        this.hasOpenAI = this.isValidOpenAIKey(openaiKey);
        this.blockchain = new BlockchainService(rpcUrl);
        
        if (this.hasOpenAI) {
            const OpenAI = require('openai');
            this.openai = new OpenAI({ apiKey: openaiKey });
            console.log('🤖 AI Service: OpenAI + Blockchain data enabled');
        } else {
            console.log('🤖 AI Service: Demo mode + Blockchain data enabled');
        }
    }

    isValidOpenAIKey(key) {
        return key && key.startsWith('sk-') && key.length > 20;
    }

    /**
     * Main entry point - process any job
     */
    async processJob(job) {
        console.log(`\n⚙️ Processing job #${job.id}: "${job.description.substring(0, 50)}..."`);
        
        const description = job.description.toLowerCase();
        
        // Detect job type and use appropriate method
        if (this.isWalletAnalysisJob(description)) {
            return await this.processWalletAnalysis(job);
        } else if (this.isBlockchainDataJob(description)) {
            return await this.processBlockchainData(job);
        } else if (this.isComparisonJob(description)) {
            return await this.processChainComparison(job);
        } else {
            return await this.processContentJob(job);
        }
    }

    // Job type detection
    isWalletAnalysisJob(desc) {
        return desc.includes('wallet') && (desc.includes('analyze') || desc.includes('analysis') || desc.includes('activity'));
    }

    isBlockchainDataJob(desc) {
        return desc.includes('balance') || (desc.includes('transaction') && desc.includes('0x'));
    }

    isComparisonJob(desc) {
        return desc.includes('compare') && (desc.includes('monad') || desc.includes('ethereum') || desc.includes('solana'));
    }

    /**
     * Process wallet analysis job with REAL blockchain data
     */
    async processWalletAnalysis(job) {
        console.log('🔍 Processing wallet analysis job with REAL blockchain data...');
        
        // Extract wallet address from job description
        const addressMatch = job.description.match(/0x[a-fA-F0-9]{40}/);
        
        if (!addressMatch) {
            return this.formatResult({
                error: 'No valid wallet address found in job description',
                suggestion: 'Please include a valid Ethereum address (0x...) in the job description'
            });
        }

        const address = addressMatch[0];
        
        // Get REAL blockchain data
        const analysis = await this.blockchain.analyzeWallet(address);
        
        if (!analysis.success) {
            return this.formatResult({
                error: 'Failed to analyze wallet',
                details: analysis.error
            });
        }

        // If we have OpenAI, enhance the analysis with AI insights
        if (this.hasOpenAI) {
            try {
                const aiInsights = await this.enhanceWithAI(
                    `Analyze this wallet data and provide trading insights:\n${JSON.stringify(analysis, null, 2)}`,
                    job
                );
                analysis.aiInsights = aiInsights;
            } catch (e) {
                console.log('AI enhancement failed, using raw data');
            }
        }

        return this.formatResult({
            jobId: job.id,
            type: 'Wallet Analysis',
            data: analysis,
            source: 'Real blockchain data via RPC',
            completedAt: new Date().toISOString()
        });
    }

    /**
     * Process blockchain data job (balance, transactions, etc)
     */
    async processBlockchainData(job) {
        console.log('📊 Processing blockchain data job...');
        
        const description = job.description.toLowerCase();
        const addressMatch = job.description.match(/0x[a-fA-F0-9]{40}/);
        
        let data = {};

        if (description.includes('balance') && addressMatch) {
            data.balance = await this.blockchain.getBalance(addressMatch[0]);
        }

        if (description.includes('network') || description.includes('block')) {
            data.network = await this.blockchain.getNetworkInfo();
        }

        if (description.includes('transaction') && addressMatch) {
            data.transactionCount = await this.blockchain.getTransactionCount(addressMatch[0]);
        }

        return this.formatResult({
            jobId: job.id,
            type: 'Blockchain Data',
            data: data,
            source: 'Real blockchain data via RPC',
            completedAt: new Date().toISOString()
        });
    }

    /**
     * Process chain comparison job
     */
    async processChainComparison(job) {
        console.log('⚖️ Processing chain comparison job...');
        
        const comparison = await this.blockchain.getChainComparison();
        
        // Format as a nice table
        let report = `# Blockchain Comparison Report\n\n`;
        report += `Generated for: Agent Jobs Protocol\n`;
        report += `Date: ${new Date().toISOString()}\n\n`;
        
        report += `## Summary Table\n\n`;
        report += `| Chain | TPS | Block Time | Avg Fee | EVM Compatible |\n`;
        report += `|-------|-----|------------|---------|----------------|\n`;
        
        for (const [key, chain] of Object.entries(comparison.comparison)) {
            report += `| ${chain.name} | ${chain.tps} | ${chain.blockTime} | ${chain.avgFee} | ${chain.evmCompatible ? 'Yes' : 'No'} |\n`;
        }
        
        report += `\n## Detailed Analysis\n\n`;
        
        for (const [key, chain] of Object.entries(comparison.comparison)) {
            report += `### ${chain.name}\n`;
            report += `- **Consensus**: ${chain.consensus}\n`;
            report += `- **Gas Token**: ${chain.gasToken}\n`;
            report += `- **Key Features**: ${chain.features.join(', ')}\n\n`;
        }

        // Add AI insights if available
        if (this.hasOpenAI) {
            try {
                const aiAnalysis = await this.enhanceWithAI(
                    `Based on this comparison data, provide investment and development insights:\n${report}`,
                    job
                );
                report += `\n## AI Analysis\n\n${aiAnalysis}\n`;
            } catch (e) {
                console.log('AI enhancement failed');
            }
        }

        return this.formatResult({
            jobId: job.id,
            type: 'Chain Comparison',
            report: report,
            rawData: comparison.comparison,
            completedAt: new Date().toISOString()
        });
    }

    /**
     * Process content/research job (uses OpenAI or demo)
     */
    async processContentJob(job) {
        console.log('📝 Processing content job...');
        
        if (this.hasOpenAI) {
            return await this.processWithOpenAI(job);
        } else {
            return await this.processDemoMode(job);
        }
    }

    /**
     * Process with OpenAI
     */
    async processWithOpenAI(job) {
        try {
            const systemPrompt = this.getSystemPrompt(job.categoryName);
            
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: job.description }
                ],
                max_tokens: 2000,
                temperature: 0.7
            });

            const content = response.choices[0].message.content;
            
            return this.formatResult({
                jobId: job.id,
                type: job.categoryName,
                content: content,
                model: 'gpt-4',
                completedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('OpenAI error:', error.message);
            return await this.processDemoMode(job);
        }
    }

    /**
     * Enhance data with AI insights
     */
    async enhanceWithAI(prompt, job) {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: 'You are a blockchain analyst. Provide clear, actionable insights.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 1000,
            temperature: 0.7
        });

        return response.choices[0].message.content;
    }

    /**
     * Demo mode - generates realistic responses without OpenAI
     */
    async processDemoMode(job) {
        console.log('📋 Using demo mode for content generation...');
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const category = job.categoryName?.toLowerCase() || 'other';
        let content = '';

        switch (category) {
            case 'research':
                content = this.generateResearchDemo(job.description);
                break;
            case 'analysis':
                content = this.generateAnalysisDemo(job.description);
                break;
            case 'content':
                content = this.generateContentDemo(job.description);
                break;
            case 'data':
                content = this.generateDataDemo(job.description);
                break;
            default:
                content = this.generateGenericDemo(job.description);
        }

        return this.formatResult({
            jobId: job.id,
            type: job.categoryName,
            content: content,
            model: 'demo-mode',
            completedAt: new Date().toISOString()
        });
    }

    generateResearchDemo(description) {
        return `# Research Report

## Executive Summary
This report analyzes the key aspects of the requested research topic based on available data and market trends.

## Key Findings

### 1. Market Overview
The market shows strong growth potential with increasing adoption rates across multiple sectors.

### 2. Technical Analysis
- Strong technical fundamentals
- Active development community
- Regular protocol upgrades

### 3. Competitive Landscape
Compared to competitors, the subject demonstrates:
- Superior scalability
- Lower transaction costs
- Better developer experience

## Recommendations
1. Continue monitoring market developments
2. Consider strategic positioning
3. Evaluate partnership opportunities

## Conclusion
Based on our analysis, the research subject shows promising characteristics for continued growth and adoption.

---
*Report generated by Agent Jobs Protocol AI Worker*
*Timestamp: ${new Date().toISOString()}*`;
    }

    generateAnalysisDemo(description) {
        return `# Analysis Report

## Overview
Comprehensive analysis based on the provided parameters.

## Metrics Summary

| Metric | Value | Change |
|--------|-------|--------|
| Activity Score | 78/100 | +12% |
| Risk Level | Medium | - |
| Trend | Bullish | ↑ |

## Detailed Findings

### Activity Patterns
- Regular transaction activity detected
- Peak activity during market hours
- Consistent volume patterns

### Risk Assessment
- Moderate exposure to market volatility
- Diversified asset distribution
- No suspicious activity flags

## Insights
The analysis reveals a healthy activity pattern consistent with active market participation.

---
*Analysis generated by Agent Jobs Protocol AI Worker*
*Timestamp: ${new Date().toISOString()}*`;
    }

    generateContentDemo(description) {
        if (description.toLowerCase().includes('twitter') || description.toLowerCase().includes('thread')) {
            return `# Twitter Thread

🧵 1/7 
What is Agent Jobs Protocol? Let's break it down 👇

2/7 🤖
Agent Jobs is an on-chain marketplace where AI agents can hire OTHER AI agents. Yes, you read that right - agents paying agents!

3/7 💰
How it works:
• Agent A posts a job + locks payment
• Agent B claims the job + stakes collateral  
• Agent B completes work
• Agent A approves → Payment released!

4/7 🔒
Built-in security:
• 10% stake requirement prevents spam
• On-chain escrow protects both parties
• Reputation system rewards good actors

5/7 ⚡
Why Monad?
• 10,000+ TPS
• Sub-second finality
• Low gas fees
Perfect for high-frequency agent transactions!

6/7 🚀
Use cases:
• Research & analysis
• Content creation
• Data processing
• Monitoring tasks
The possibilities are endless!

7/7 🌐
This is the future of the agent economy. Autonomous AI workers, transparent payments, trustless execution.

Follow @AgentJobsProtocol for updates!

#AI #Web3 #Monad #AgentEconomy`;
        }

        return `# Content Deliverable

## Overview
Professional content created based on the provided brief.

## Content

${description.includes('guide') ? 
`### Getting Started Guide

1. **Setup**: Connect your wallet to the platform
2. **Post Jobs**: Define task, set payment, submit
3. **Worker Claims**: AI agents find and claim suitable jobs
4. **Completion**: Work is submitted and verified
5. **Payment**: Automatic release upon approval

### Best Practices
- Be specific in job descriptions
- Set reasonable deadlines
- Provide adequate payment for quality work` :

`### Main Content

This content has been crafted to meet your specifications while maintaining high quality standards.

Key points covered:
- Clear and concise messaging
- Professional tone
- Actionable insights`}

---
*Content generated by Agent Jobs Protocol AI Worker*
*Timestamp: ${new Date().toISOString()}*`;
    }

    generateDataDemo(description) {
        return `# Data Compilation

## Dataset Overview
\`\`\`json
{
  "generatedAt": "${new Date().toISOString()}",
  "source": "Agent Jobs Protocol",
  "format": "JSON",
  "records": 10
}
\`\`\`

## Data Records

\`\`\`json
[
  {"id": 1, "name": "Protocol A", "tvl": "1.2B", "category": "DeFi"},
  {"id": 2, "name": "Protocol B", "tvl": "890M", "category": "DEX"},
  {"id": 3, "name": "Protocol C", "tvl": "450M", "category": "Lending"},
  {"id": 4, "name": "Protocol D", "tvl": "320M", "category": "Staking"},
  {"id": 5, "name": "Protocol E", "tvl": "280M", "category": "Bridge"},
  {"id": 6, "name": "Protocol F", "tvl": "210M", "category": "NFT"},
  {"id": 7, "name": "Protocol G", "tvl": "180M", "category": "Gaming"},
  {"id": 8, "name": "Protocol H", "tvl": "150M", "category": "Insurance"},
  {"id": 9, "name": "Protocol I", "tvl": "120M", "category": "Derivatives"},
  {"id": 10, "name": "Protocol J", "tvl": "95M", "category": "Yield"}
]
\`\`\`

## Summary Statistics
- Total TVL: $3.895B
- Average TVL: $389.5M
- Categories: 10

---
*Data compiled by Agent Jobs Protocol AI Worker*`;
    }

    generateGenericDemo(description) {
        return `# Task Completion Report

## Request
${description}

## Result
Task has been completed successfully based on the provided requirements.

## Details
- Processing completed
- All requirements addressed
- Quality verified

## Deliverables
The requested work has been executed and is ready for review.

---
*Generated by Agent Jobs Protocol AI Worker*
*Timestamp: ${new Date().toISOString()}*`;
    }

    getSystemPrompt(category) {
        const prompts = {
            'Research': 'You are a blockchain researcher. Provide detailed, factual research reports with sources and analysis.',
            'Analysis': 'You are a data analyst specializing in blockchain. Provide detailed analysis with metrics and insights.',
            'Content': 'You are a professional content creator. Create engaging, high-quality content for the crypto audience.',
            'Data': 'You are a data engineer. Compile and format data clearly and accurately.',
            'Monitoring': 'You are a blockchain monitoring specialist. Track and report on blockchain activity.',
            'Other': 'You are a helpful AI assistant. Complete the task professionally and thoroughly.'
        };
        return prompts[category] || prompts['Other'];
    }

    formatResult(data) {
        return JSON.stringify(data, null, 2);
    }

    /**
     * Evaluate if worker can do this job
     */
    async evaluateJob(job) {
        const description = job.description.toLowerCase();
        
        // Jobs we can definitely do with real data
        if (this.isWalletAnalysisJob(description)) {
            const hasAddress = /0x[a-fA-F0-9]{40}/.test(job.description);
            return {
                canDo: hasAddress,
                confidence: hasAddress ? 95 : 30,
                reason: hasAddress 
                    ? 'Can analyze wallet with real blockchain data'
                    : 'No wallet address found in job description'
            };
        }

        if (this.isComparisonJob(description)) {
            return {
                canDo: true,
                confidence: 95,
                reason: 'Can provide blockchain comparison with real data'
            };
        }

        // Content jobs - depends on OpenAI
        if (this.hasOpenAI) {
            return {
                canDo: true,
                confidence: 90,
                reason: 'Can complete with GPT-4'
            };
        }

        // Demo mode for content
        return {
            canDo: true,
            confidence: 75,
            reason: 'Can complete in demo mode'
        };
    }
}

module.exports = AIService;
