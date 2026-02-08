/**
 * AI Service - TaskForge
 * Truncates results to prevent contract errors
 */

const OpenAI = require('openai');
const BlockchainService = require('./blockchainService');

const MAX_RESULT_LENGTH = 1200;

class AIService {
    constructor(openaiApiKey, rpcUrl) {
        this.openaiApiKey = openaiApiKey;
        this.blockchainService = new BlockchainService(rpcUrl);
        
        if (openaiApiKey) {
            this.openai = new OpenAI({ apiKey: openaiApiKey });
            console.log('🤖 AI Service: OpenAI enabled');
        } else {
            this.openai = null;
            console.log('🤖 AI Service: Demo mode');
        }
    }

    truncate(text, max = MAX_RESULT_LENGTH) {
        if (text.length <= max) return text;
        return text.substring(0, max - 20) + '... [truncated]';
    }

    async canDoTask(description) {
        const d = description.toLowerCase();
        const canDo = d.includes('research') || d.includes('analyz') || d.includes('wallet') ||
            d.includes('find') || d.includes('yield') || d.includes('defi') || d.includes('monad') ||
            d.includes('blockchain') || d.includes('token') || d.includes('price') || d.includes('compare') ||
            d.includes('list') || d.includes('explain') || d.includes('report') || d.includes('data');
        return { canDo, confidence: canDo ? 85 : 20 };
    }

    async processTask(job) {
        console.log(`🧠 Processing: "${job.description.substring(0, 50)}..."`);
        
        const desc = job.description.toLowerCase();
        const walletMatch = job.description.match(/0x[a-fA-F0-9]{40}/);

        // Wallet analysis
        if (walletMatch && (desc.includes('wallet') || desc.includes('analyz') || desc.includes('check') || desc.includes('history') || desc.includes('balance'))) {
            return await this.walletTask(walletMatch[0]);
        }

        // AI task
        if (this.openai) {
            try {
                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a Monad blockchain expert. Give SHORT, CONCISE answers (max 400 chars). Focus on DeFi, yields, protocols, wallet analysis. If asked about non-blockchain topics, briefly say you specialize in blockchain/Monad topics.'
                        },
                        { role: 'user', content: job.description }
                    ],
                    max_tokens: 200
                });

                const result = {
                    task: job.description.substring(0, 100),
                    answer: completion.choices[0].message.content,
                    by: 'Forge Agent',
                    at: new Date().toISOString()
                };
                
                return this.truncate(JSON.stringify(result));
            } catch (err) {
                console.error('OpenAI error:', err.message);
            }
        }

        // Fallback
        const result = {
            task: job.description.substring(0, 100),
            answer: this.getFallback(desc),
            by: 'Forge Agent',
            at: new Date().toISOString()
        };
        return this.truncate(JSON.stringify(result));
    }

    async walletTask(address) {
        const analysis = await this.blockchainService.analyzeWallet(address);
        const result = {
            type: 'Wallet Analysis',
            address: address,
            balance: analysis.balance,
            txs: analysis.transactionCount,
            activity: analysis.activityLevel,
            at: new Date().toISOString()
        };
        return this.truncate(JSON.stringify(result));
    }

    getFallback(desc) {
        if (desc.includes('yield') || desc.includes('defi')) {
            return 'Monad DeFi is emerging. Check DEXs for swap fees, lending for APY, LP pools for rewards. DYOR.';
        }
        if (desc.includes('monad')) {
            return 'Monad: High-performance EVM L1. 10,000+ TPS, <1s finality, ultra-low fees.';
        }
        return 'Task processed. I specialize in Monad blockchain, DeFi, and wallet analysis.';
    }
}

module.exports = AIService;
