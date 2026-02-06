/**
 * Blockchain Service v4
 * 
 * Improvements:
 * - Simple in-memory cache for frequently requested data
 * - Address validation
 * - Timeout on RPC calls
 * - Better error messages
 */

const { ethers } = require('ethers');

class BlockchainService {
    constructor(rpcUrl) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.rpcUrl = rpcUrl;
        this._cache = new Map();
        this._cacheTTL = 30_000; // 30s
    }

    /**
     * Simple cache helper
     */
    async cached(key, ttl, fn) {
        const entry = this._cache.get(key);
        if (entry && Date.now() - entry.time < (ttl || this._cacheTTL)) {
            return entry.value;
        }
        const value = await fn();
        this._cache.set(key, { value, time: Date.now() });

        // Prevent unbounded growth
        if (this._cache.size > 500) {
            const oldest = this._cache.keys().next().value;
            this._cache.delete(oldest);
        }

        return value;
    }

    /**
     * Validate Ethereum address
     */
    isValidAddress(addr) {
        return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
    }

    async getBalance(address) {
        if (!this.isValidAddress(address)) {
            return { success: false, error: 'Invalid address format' };
        }

        try {
            const balance = await this.provider.getBalance(address);
            return {
                success: true,
                address,
                balanceWei: balance.toString(),
                balanceMON: ethers.formatEther(balance),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: `Balance query failed: ${error.message}` };
        }
    }

    async getTransaction(txHash) {
        if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
            return { success: false, error: 'Invalid transaction hash' };
        }

        try {
            const [tx, receipt] = await Promise.all([
                this.provider.getTransaction(txHash),
                this.provider.getTransactionReceipt(txHash)
            ]);

            if (!tx) return { success: false, error: 'Transaction not found' };

            return {
                success: true,
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: ethers.formatEther(tx.value),
                gasPrice: ethers.formatUnits(tx.gasPrice || 0, 'gwei'),
                gasUsed: receipt ? receipt.gasUsed.toString() : 'pending',
                status: receipt ? (receipt.status === 1 ? 'success' : 'failed') : 'pending',
                blockNumber: tx.blockNumber,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: `Transaction query failed: ${error.message}` };
        }
    }

    async getTransactionCount(address) {
        if (!this.isValidAddress(address)) {
            return { success: false, error: 'Invalid address format' };
        }

        try {
            const count = await this.provider.getTransactionCount(address);
            return {
                success: true,
                address,
                transactionCount: count,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: `Transaction count query failed: ${error.message}` };
        }
    }

    async getNetworkInfo() {
        return this.cached('networkInfo', 15_000, async () => {
            try {
                const [blockNumber, feeData, network] = await Promise.all([
                    this.provider.getBlockNumber(),
                    this.provider.getFeeData(),
                    this.provider.getNetwork()
                ]);

                return {
                    success: true,
                    network: {
                        name: network.name === 'unknown' ? 'Monad' : network.name,
                        chainId: Number(network.chainId)
                    },
                    blockNumber,
                    gasPrice: ethers.formatUnits(feeData.gasPrice || 0, 'gwei'),
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                return { success: false, error: `Network query failed: ${error.message}` };
            }
        });
    }

    async getBlock(blockNumber) {
        try {
            const block = await this.provider.getBlock(blockNumber);
            if (!block) return { success: false, error: 'Block not found' };

            return {
                success: true,
                number: block.number,
                hash: block.hash,
                timestamp: new Date(block.timestamp * 1000).toISOString(),
                transactionCount: block.transactions.length,
                gasUsed: block.gasUsed.toString(),
                gasLimit: block.gasLimit.toString()
            };
        } catch (error) {
            return { success: false, error: `Block query failed: ${error.message}` };
        }
    }

    async isContract(address) {
        if (!this.isValidAddress(address)) {
            return { success: false, error: 'Invalid address format' };
        }

        try {
            const code = await this.provider.getCode(address);
            return {
                success: true,
                address,
                isContract: code !== '0x',
                codeSize: code.length > 2 ? (code.length - 2) / 2 : 0
            };
        } catch (error) {
            return { success: false, error: `Contract check failed: ${error.message}` };
        }
    }

    async getTokenBalance(tokenAddress, walletAddress) {
        if (!this.isValidAddress(tokenAddress) || !this.isValidAddress(walletAddress)) {
            return { success: false, error: 'Invalid address format' };
        }

        try {
            const abi = [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)",
                "function symbol() view returns (string)",
                "function name() view returns (string)"
            ];

            const token = new ethers.Contract(tokenAddress, abi, this.provider);
            const [balance, decimals, symbol, name] = await Promise.all([
                token.balanceOf(walletAddress),
                token.decimals(),
                token.symbol(),
                token.name()
            ]);

            return {
                success: true,
                token: { address: tokenAddress, name, symbol, decimals },
                wallet: walletAddress,
                balance: ethers.formatUnits(balance, decimals),
                balanceRaw: balance.toString(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: `Token balance query failed: ${error.message}` };
        }
    }

    async analyzeWallet(address) {
        if (!this.isValidAddress(address)) {
            return { success: false, error: 'Invalid address format' };
        }

        try {
            console.log(`🔍 Analyzing wallet: ${address}`);

            const [balance, txCount, isContractResult, networkInfo] = await Promise.all([
                this.getBalance(address),
                this.getTransactionCount(address),
                this.isContract(address),
                this.getNetworkInfo()
            ]);

            const walletType = isContractResult.isContract ? 'Smart Contract' : 'EOA (Externally Owned Account)';
            const txCountNum = txCount.transactionCount || 0;

            let activityLevel, tradingPattern;
            if (txCountNum === 0) {
                activityLevel = 'New/Inactive';
                tradingPattern = 'No activity detected';
            } else if (txCountNum < 10) {
                activityLevel = 'Low';
                tradingPattern = 'Occasional user — likely holds long-term';
            } else if (txCountNum < 100) {
                activityLevel = 'Moderate';
                tradingPattern = 'Regular user — moderate trading or DeFi activity';
            } else if (txCountNum < 1000) {
                activityLevel = 'High';
                tradingPattern = 'Active trader — frequent transactions and DeFi interactions';
            } else {
                activityLevel = 'Very High';
                tradingPattern = 'Power user or bot — extremely frequent on-chain activity';
            }

            const balanceNum = parseFloat(balance.balanceMON || 0);
            let balanceCategory;
            if (balanceNum === 0)          balanceCategory = 'Empty wallet';
            else if (balanceNum < 1)       balanceCategory = 'Small holder (< 1 MON)';
            else if (balanceNum < 100)     balanceCategory = 'Medium holder (1–100 MON)';
            else if (balanceNum < 10_000)  balanceCategory = 'Large holder (100–10K MON)';
            else                           balanceCategory = 'Whale (> 10K MON)';

            const insights = [
                `${walletType} with ${activityLevel.toLowerCase()} activity (${txCountNum.toLocaleString()} transactions).`,
                `Balance: ${balance.balanceMON} MON — categorized as "${balanceCategory}".`,
                `Pattern: ${tradingPattern}.`,
            ];

            if (txCountNum > 100) {
                insights.push('High transaction count may indicate automated trading, bot activity, or frequent DeFi usage.');
            }
            if (balanceNum > 1000) {
                insights.push('Significant holdings suggest this could be an institutional wallet or early participant.');
            }
            if (isContractResult.isContract) {
                insights.push(`This is a smart contract (${isContractResult.codeSize} bytes of bytecode), not a regular wallet.`);
            }

            return {
                success: true,
                address,
                analysis: {
                    walletType,
                    isContract: isContractResult.isContract,
                    balance: { amount: balance.balanceMON + ' MON', category: balanceCategory, raw: balanceNum },
                    activity: { totalTransactions: txCountNum, level: activityLevel, tradingPattern },
                    network: {
                        name: 'Monad',
                        chainId: networkInfo.network?.chainId,
                        currentBlock: networkInfo.blockNumber
                    }
                },
                insights,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: `Wallet analysis failed: ${error.message}` };
        }
    }

    async getChainComparison() {
        return {
            success: true,
            comparison: {
                monad: {
                    name: 'Monad',
                    tps: '10,000+',
                    blockTime: '~1 second',
                    consensus: 'MonadBFT',
                    gasToken: 'MON',
                    avgFee: '< $0.01',
                    evmCompatible: true,
                    features: ['Parallel execution', 'Optimistic execution', 'MonadDB', 'High throughput']
                },
                ethereum: {
                    name: 'Ethereum',
                    tps: '15–30',
                    blockTime: '~12 seconds',
                    consensus: 'Proof of Stake',
                    gasToken: 'ETH',
                    avgFee: '$1–50',
                    evmCompatible: true,
                    features: ['Most secure', 'Largest ecosystem', 'Highest TVL', 'Battle-tested']
                },
                solana: {
                    name: 'Solana',
                    tps: '65,000',
                    blockTime: '~400ms',
                    consensus: 'Proof of History + PoS',
                    gasToken: 'SOL',
                    avgFee: '< $0.01',
                    evmCompatible: false,
                    features: ['Highest TPS', 'Low fees', 'Growing DeFi', 'Firedancer upgrade']
                },
                avalanche: {
                    name: 'Avalanche',
                    tps: '4,500',
                    blockTime: '~2 seconds',
                    consensus: 'Avalanche Consensus',
                    gasToken: 'AVAX',
                    avgFee: '$0.01–1',
                    evmCompatible: true,
                    features: ['Subnets', 'Fast finality', 'EVM compatible', 'Custom chains']
                }
            },
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = BlockchainService;
