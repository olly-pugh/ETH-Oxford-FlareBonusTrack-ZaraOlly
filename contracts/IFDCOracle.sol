// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/**
 * @title IFDCOracle
 * @notice Interface for the Flare Data Connector oracle shim.
 *         In production this would be the on-chain FDC verification contract.
 */
interface IFDCOracle {
    /// @notice Returns the carbon intensity for a given attestation key.
    /// @param key keccak256(timestamp) identifying the half-hour slot.
    function getIntensity(bytes32 key) external view returns (uint256);

    /// @notice Total number of attestations stored.
    function attestationCount() external view returns (uint256);
}
