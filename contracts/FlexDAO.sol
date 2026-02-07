// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./IFDCOracle.sol";

/**
 * @title FlexDAO
 * @notice On-chain verification and reward distribution for demand-flexibility.
 *
 * Flow:
 *   1. Operator submits a flex event (slot key, list of participants, kW shifted).
 *   2. Contract reads FDCShim to verify the slot was indeed high-carbon (≥ threshold).
 *   3. If verified, each participant's reward balance increases proportionally.
 *   4. Participants can claim accumulated rewards.
 *
 * Rewards are in "FLEX tokens" (tracked as a simple uint mapping for the PoC —
 * a production version would use ERC-20).
 */
contract FlexDAO {
    IFDCOracle public oracle;
    address public operator;
    uint256 public intensityThreshold; // gCO2/kWh

    // Reward rate: FLEX tokens per kW shifted in a verified event
    uint256 public rewardPerKw = 10;

    // Participant balances (address → FLEX tokens)
    mapping(address => uint256) public balances;

    // Track processed slots to prevent double-claiming
    mapping(bytes32 => bool) public processedSlots;

    // Stats
    uint256 public totalEventsVerified;
    uint256 public totalRewardsIssued;

    struct FlexParticipant {
        address participant;
        uint256 shiftedKw; // in whole kW (scaled by 1000 for precision → milliKw)
    }

    event FlexEventVerified(
        bytes32 indexed slotKey,
        uint256 intensity,
        uint256 participantCount,
        uint256 totalShiftedKw
    );
    event RewardClaimed(address indexed participant, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "FlexDAO: not operator");
        _;
    }

    constructor(address _oracle, uint256 _threshold) {
        oracle = IFDCOracle(_oracle);
        operator = msg.sender;
        intensityThreshold = _threshold;
    }

    /**
     * @notice Submit a verified flex event.
     * @param slotKey keccak256(timestamp) — must exist in FDCShim
     * @param participants Array of (address, shiftedKw) tuples
     */
    function submitFlexEvent(
        bytes32 slotKey,
        FlexParticipant[] calldata participants
    ) external onlyOperator {
        require(!processedSlots[slotKey], "FlexDAO: slot already processed");

        // Read carbon intensity from FDC oracle
        uint256 intensity = oracle.getIntensity(slotKey);
        require(
            intensity >= intensityThreshold,
            "FlexDAO: intensity below threshold"
        );

        processedSlots[slotKey] = true;
        totalEventsVerified++;

        uint256 totalShifted = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            uint256 reward = (participants[i].shiftedKw * rewardPerKw) / 1000;
            if (reward == 0) reward = 1; // minimum 1 token
            balances[participants[i].participant] += reward;
            totalRewardsIssued += reward;
            totalShifted += participants[i].shiftedKw;
        }

        emit FlexEventVerified(slotKey, intensity, participants.length, totalShifted);
    }

    /**
     * @notice Claim accumulated FLEX rewards.
     */
    function claimRewards() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "FlexDAO: no rewards");
        balances[msg.sender] = 0;
        // In production: transfer ERC-20 tokens here
        emit RewardClaimed(msg.sender, amount);
    }

    /**
     * @notice View function for dashboard.
     */
    function getStats()
        external
        view
        returns (
            uint256 eventsVerified,
            uint256 rewardsIssued,
            uint256 threshold,
            uint256 attestations
        )
    {
        return (
            totalEventsVerified,
            totalRewardsIssued,
            intensityThreshold,
            oracle.attestationCount()
        );
    }
}
