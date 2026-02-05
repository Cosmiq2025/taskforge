// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentJobs
 * @notice On-chain marketplace where AI agents post jobs and other agents complete them
 * @dev Part of Agent Job Protocol for Moltiverse Hackathon
 */
contract AgentJobs {
    
    // ============ Enums ============
    
    enum JobStatus { Open, Claimed, Submitted, Completed, Disputed, Cancelled, Expired }
    enum JobCategory { Research, Analysis, Monitoring, Content, Data, Other }
    
    // ============ Structs ============
    
    struct Job {
        uint256 id;
        address client;
        address worker;
        string description;
        JobCategory category;
        uint256 payment;
        uint256 stakeRequired;
        uint256 workerStake;
        uint256 createdAt;
        uint256 deadline;
        uint256 submittedAt;
        string resultHash;
        JobStatus status;
    }
    
    struct AgentStats {
        uint256 jobsPosted;
        uint256 jobsCompleted;
        uint256 jobsFailed;
        uint256 totalEarned;
        uint256 totalSpent;
        uint256 reputation;
    }
    
    // ============ State ============
    
    uint256 public jobCounter;
    uint256 public totalPayouts;
    uint256 public constant MIN_PAYMENT = 0.01 ether;
    uint256 public constant STAKE_PERCENT = 10;
    uint256 public constant AUTO_APPROVE_DELAY = 24 hours;
    uint256 public constant PROTOCOL_FEE = 25; // 2.5%
    
    address public owner;
    address public feeRecipient;
    
    mapping(uint256 => Job) private _jobs;
    mapping(address => AgentStats) private _agentStats;
    mapping(address => uint256[]) private _agentJobsPosted;
    mapping(address => uint256[]) private _agentJobsClaimed;
    
    // ============ Events ============
    
    event JobPosted(uint256 indexed jobId, address indexed client, uint256 payment, uint256 deadline);
    event JobClaimed(uint256 indexed jobId, address indexed worker, uint256 stake);
    event JobSubmitted(uint256 indexed jobId, address indexed worker);
    event JobCompleted(uint256 indexed jobId, address indexed worker, uint256 payout);
    event JobDisputed(uint256 indexed jobId, address indexed client);
    event JobCancelled(uint256 indexed jobId, address indexed client);
    
    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    // ============ Constructor ============
    
    constructor() {
        owner = msg.sender;
        feeRecipient = msg.sender;
    }
    
    // ============ Core Functions ============
    
    function postJob(
        string calldata _description,
        JobCategory _category,
        uint256 _deadlineHours
    ) external payable returns (uint256) {
        require(msg.value >= MIN_PAYMENT, "Payment too low");
        require(_deadlineHours >= 1 && _deadlineHours <= 168, "Deadline 1-168 hours");
        
        uint256 newJobId = ++jobCounter;
        uint256 stakeReq = (msg.value * STAKE_PERCENT) / 100;
        uint256 deadlineTime = block.timestamp + (_deadlineHours * 1 hours);
        
        Job storage job = _jobs[newJobId];
        job.id = newJobId;
        job.client = msg.sender;
        job.description = _description;
        job.category = _category;
        job.payment = msg.value;
        job.stakeRequired = stakeReq;
        job.createdAt = block.timestamp;
        job.deadline = deadlineTime;
        job.status = JobStatus.Open;
        
        _agentStats[msg.sender].jobsPosted++;
        _agentStats[msg.sender].totalSpent += msg.value;
        _agentJobsPosted[msg.sender].push(newJobId);
        
        emit JobPosted(newJobId, msg.sender, msg.value, deadlineTime);
        
        return newJobId;
    }
    
    function claimJob(uint256 _jobId) external payable {
        Job storage job = _jobs[_jobId];
        
        require(job.id != 0, "Job not found");
        require(job.status == JobStatus.Open, "Job not open");
        require(msg.sender != job.client, "Cannot claim own job");
        require(block.timestamp < job.deadline, "Job expired");
        require(msg.value >= job.stakeRequired, "Insufficient stake");
        
        job.worker = msg.sender;
        job.workerStake = msg.value;
        job.status = JobStatus.Claimed;
        
        _agentJobsClaimed[msg.sender].push(_jobId);
        
        emit JobClaimed(_jobId, msg.sender, msg.value);
    }
    
    function submitResult(uint256 _jobId, string calldata _resultHash) external {
        Job storage job = _jobs[_jobId];
        
        require(job.status == JobStatus.Claimed, "Job not claimed");
        require(msg.sender == job.worker, "Not the worker");
        require(bytes(_resultHash).length > 0, "Empty result");
        
        job.resultHash = _resultHash;
        job.submittedAt = block.timestamp;
        job.status = JobStatus.Submitted;
        
        emit JobSubmitted(_jobId, msg.sender);
    }
    
    function approveResult(uint256 _jobId) external {
        Job storage job = _jobs[_jobId];
        
        require(job.status == JobStatus.Submitted, "No result to approve");
        require(msg.sender == job.client, "Not the client");
        
        _completeJob(_jobId);
    }
    
    function autoApprove(uint256 _jobId) external {
        Job storage job = _jobs[_jobId];
        
        require(job.status == JobStatus.Submitted, "No result to approve");
        require(block.timestamp >= job.submittedAt + AUTO_APPROVE_DELAY, "Too early");
        
        _completeJob(_jobId);
    }
    
    function disputeResult(uint256 _jobId) external {
        Job storage job = _jobs[_jobId];
        
        require(job.status == JobStatus.Submitted, "No result to dispute");
        require(msg.sender == job.client, "Not the client");
        
        job.status = JobStatus.Disputed;
        
        emit JobDisputed(_jobId, msg.sender);
    }
    
    function cancelJob(uint256 _jobId) external {
        Job storage job = _jobs[_jobId];
        
        require(job.status == JobStatus.Open, "Job already claimed");
        require(msg.sender == job.client, "Not the client");
        
        job.status = JobStatus.Cancelled;
        
        _sendPayment(job.client, job.payment);
        
        emit JobCancelled(_jobId, msg.sender);
    }
    
    function claimExpired(uint256 _jobId) external {
        Job storage job = _jobs[_jobId];
        
        require(job.status == JobStatus.Claimed, "Job not claimed");
        require(block.timestamp > job.deadline, "Deadline not passed");
        
        job.status = JobStatus.Expired;
        
        _agentStats[job.worker].jobsFailed++;
        _updateReputation(job.worker, false);
        
        _sendPayment(job.client, job.payment + job.workerStake);
    }
    
    // ============ Internal Functions ============
    
    function _completeJob(uint256 _jobId) internal {
        Job storage job = _jobs[_jobId];
        
        job.status = JobStatus.Completed;
        
        uint256 fee = (job.payment * PROTOCOL_FEE) / 1000;
        uint256 payout = job.payment - fee + job.workerStake;
        
        _agentStats[job.worker].jobsCompleted++;
        _agentStats[job.worker].totalEarned += (job.payment - fee);
        _updateReputation(job.worker, true);
        
        totalPayouts += payout;
        
        if (fee > 0) {
            _sendPayment(feeRecipient, fee);
        }
        
        _sendPayment(job.worker, payout);
        
        emit JobCompleted(_jobId, job.worker, payout);
    }
    
    function _sendPayment(address _to, uint256 _amount) internal {
        (bool sent, ) = _to.call{value: _amount}("");
        require(sent, "Payment failed");
    }
    
    function _updateReputation(address _agent, bool _success) internal {
        if (_success) {
            if (_agentStats[_agent].reputation <= 900) {
                _agentStats[_agent].reputation += 100;
            } else {
                _agentStats[_agent].reputation = 1000;
            }
        } else {
            if (_agentStats[_agent].reputation >= 100) {
                _agentStats[_agent].reputation -= 100;
            } else {
                _agentStats[_agent].reputation = 0;
            }
        }
    }
    
    // ============ View Functions (Split to avoid stack depth) ============
    
    function getJobCore(uint256 _jobId) external view returns (
        uint256 id,
        address client,
        address worker,
        JobCategory category,
        JobStatus status
    ) {
        Job storage job = _jobs[_jobId];
        return (job.id, job.client, job.worker, job.category, job.status);
    }
    
    function getJobPayment(uint256 _jobId) external view returns (
        uint256 payment,
        uint256 stakeRequired,
        uint256 workerStake
    ) {
        Job storage job = _jobs[_jobId];
        return (job.payment, job.stakeRequired, job.workerStake);
    }
    
    function getJobTiming(uint256 _jobId) external view returns (
        uint256 createdAt,
        uint256 deadline,
        uint256 submittedAt
    ) {
        Job storage job = _jobs[_jobId];
        return (job.createdAt, job.deadline, job.submittedAt);
    }
    
    function getJobDescription(uint256 _jobId) external view returns (string memory) {
        return _jobs[_jobId].description;
    }
    
    function getJobResult(uint256 _jobId) external view returns (string memory) {
        return _jobs[_jobId].resultHash;
    }
    
    function getAgentStats(address _agent) external view returns (
        uint256 jobsPosted,
        uint256 jobsCompleted,
        uint256 jobsFailed,
        uint256 totalEarned,
        uint256 totalSpent,
        uint256 reputation
    ) {
        AgentStats storage stats = _agentStats[_agent];
        return (
            stats.jobsPosted,
            stats.jobsCompleted,
            stats.jobsFailed,
            stats.totalEarned,
            stats.totalSpent,
            stats.reputation
        );
    }
    
    function getAgentPostedJobs(address _agent) external view returns (uint256[] memory) {
        return _agentJobsPosted[_agent];
    }
    
    function getAgentClaimedJobs(address _agent) external view returns (uint256[] memory) {
        return _agentJobsClaimed[_agent];
    }
    
    function isJobOpen(uint256 _jobId) external view returns (bool) {
        return _jobs[_jobId].status == JobStatus.Open && block.timestamp < _jobs[_jobId].deadline;
    }
    
    // ============ Admin Functions ============
    
    function setFeeRecipient(address _newRecipient) external onlyOwner {
        feeRecipient = _newRecipient;
    }
    
    function resolveDispute(uint256 _jobId, bool _workerWins) external onlyOwner {
        Job storage job = _jobs[_jobId];
        require(job.status == JobStatus.Disputed, "Not disputed");
        
        if (_workerWins) {
            _completeJob(_jobId);
        } else {
            job.status = JobStatus.Cancelled;
            _agentStats[job.worker].jobsFailed++;
            _updateReputation(job.worker, false);
            _sendPayment(job.client, job.payment + job.workerStake);
        }
    }
}
