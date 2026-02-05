/**
 * Blockchain Service - Real On-Chain Data Fetching
 * 
 * Allows AI worker to fetch real blockchain data:
 * - Wallet balances
 * - Transaction history
 * - Token holdings
 * - Contract interactions
 */

const { ethers } = require('ethers');

class BlockchainService {
    constructor(rpcUrl) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.rpcUrl = rpcUrl;
    }

    /**
     * Get wallet balance
     */
    async getBalance(address) {
        try {
            const balance = await this.provider.getBalance(address);
            return {
                success: true,
                address: address,
                balanceWei: balance.toString(),
                balanceMON: ethers.formatEther(balance),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get transaction details
     */
    async getTransaction(txHash) {
        try {
            const tx = await this.provider.getTransaction(txHash);
            const receipt = await this.provider.getTransactionReceipt(txHash);
            
            if (!tx) {
                return { success: false, error: 'Transaction not found' };
            }

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
            return { success: false, error: error.message };
        }
    }

    /**
     * Get transaction count (nonce) for address
     */
    async getTransactionCount(address) {
        try {
            const count = await this.provider.getTransactionCount(address);
            return {
                success: true,
                address: address,
                transactionCount: count,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get current block number and gas price
     */
    async getNetworkInfo() {
        try {
            const [blockNumber, feeData, network] = await Promise.all([
                this.provider.getBlockNumber(),
                this.provider.getFeeData(),
                this.provider.getNetwork()
            ]);

            return {
                success: true,
                network: {
                    name: network.name,
                    chainId: Number(network.chainId)
                },
                blockNumber: blockNumber,
                gasPrice: ethers.formatUnits(feeData.gasPrice || 0, 'gwei'),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get block details
     */
    async getBlock(blockNumber) {
        try {
            const block = await this.provider.getBlock(blockNumber);
            
            if (!block) {
                return { success: false, error: 'Block not found' };
            }

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
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if address is a contract
     */
    async isContract(address) {
        try {
            const code = await this.provider.getCode(address);
            return {
                success: true,
                address: address,
                isContract: code !== '0x',
                codeSize: code.length > 2 ? (code.length - 2) / 2 : 0
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get ERC20 token balance
     */
    async getTokenBalance(tokenAddress, walletAddress) {
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
                token: {
                    address: tokenAddress,
                    name: name,
                    symbol: symbol,
                    decimals: decimals
                },
                wallet: walletAddress,
                balance: ethers.formatUnits(balance, decimals),
                balanceRaw: balance.toString(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Analyze wallet activity - FULL ANALYSIS
     */
    async analyzeWallet(address) {
        try {
            console.log(`🔍 Analyzing wallet: ${address}`);
            
            const [balance, txCount, isContract, networkInfo] = await Promise.all([
                this.getBalance(address),
                this.getTransactionCount(address),
                this.isContract(address),
                this.getNetworkInfo()
            ]);

            // Determine wallet type
            let walletType = 'Unknown';
            if (isContract.isContract) {
                walletType = 'Smart Contract';
            } else {
                walletType = 'EOA (Externally Owned Account)';
            }

            // Determine activity level
            const txCountNum = txCount.transactionCount || 0;
            let activityLevel = 'Unknown';
            let tradingPattern = 'Unknown';
            
            if (txCountNum === 0) {
                activityLevel = 'New/Inactive';
                tradingPattern = 'No activity detected';
            } else if (txCountNum < 10) {
                activityLevel = 'Low';
                tradingPattern = 'Occasional user - likely holds long-term';
            } else if (txCountNum < 100) {
                activityLevel = 'Medium';
                tradingPattern = 'Regular user - moderate trading activity';
            } else if (txCountNum < 1000) {
                activityLevel = 'High';
                tradingPattern = 'Active trader - frequent transactions';
            } else {
                activityLevel = 'Very High';
                tradingPattern = 'Power user/Bot - extremely frequent activity';
            }

            // Categorize by balance
            const balanceNum = parseFloat(balance.balanceMON || 0);
            let balanceCategory = 'Unknown';
            if (balanceNum === 0) {
                balanceCategory = 'Empty wallet';
            } else if (balanceNum < 1) {
                balanceCategory = 'Small holder (< 1 MON)';
            } else if (balanceNum < 100) {
                balanceCategory = 'Medium holder (1-100 MON)';
            } else if (balanceNum < 10000) {
                balanceCategory = 'Large holder (100-10K MON)';
            } else {
                balanceCategory = 'Whale (> 10K MON)';
            }

            return {
                success: true,
                address: address,
                analysis: {
                    walletType: walletType,
                    isContract: isContract.isContract,
                    balance: {
                        amount: balance.balanceMON + ' MON',
                        category: balanceCategory
                    },
                    activity: {
                        totalTransactions: txCountNum,
                        level: activityLevel,
                        tradingPattern: tradingPattern
                    },
                    network: {
                        name: 'Monad',
                        chainId: networkInfo.network?.chainId,
                        currentBlock: networkInfo.blockNumber
                    }
                },
                insights: [
                    `This is a ${walletType.toLowerCase()} with ${activityLevel.toLowerCase()} activity.`,
                    `Balance category: ${balanceCategory}.`,
                    `Trading pattern suggests: ${tradingPattern}.`,
                    txCountNum > 100 ? 'High transaction count may indicate automated trading or frequent DeFi usage.' : '',
                    balanceNum > 1000 ? 'Significant holdings suggest this could be a whale or institutional wallet.' : ''
                ].filter(Boolean),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Compare multiple blockchains (for research tasks)
     */
    async getChainComparison() {
        // Static data for comparison - could be enhanced with live data
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
                    features: ['Parallel execution', 'Optimistic execution', 'High throughput']
                },
                ethereum: {
                    name: 'Ethereum',
                    tps: '15-30',
                    blockTime: '~12 seconds',
                    consensus: 'Proof of Stake',
                    gasToken: 'ETH',
                    avgFee: '$1-50',
                    evmCompatible: true,
                    features: ['Most secure', 'Largest ecosystem', 'Highest TVL']
                },
                solana: {
                    name: 'Solana',
                    tps: '65,000',
                    blockTime: '~400ms',
                    consensus: 'Proof of History + PoS',
                    gasToken: 'SOL',
                    avgFee: '< $0.01',
                    evmCompatible: false,
                    features: ['Highest TPS', 'Low fees', 'Growing DeFi']
                },
                avalanche: {
                    name: 'Avalanche',
                    tps: '4,500',
                    blockTime: '~2 seconds',
                    consensus: 'Avalanche Consensus',
                    gasToken: 'AVAX',
                    avgFee: '$0.01-1',
                    evmCompatible: true,
                    features: ['Subnets', 'Fast finality', 'EVM compatible']
                }
            },
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = BlockchainService;
