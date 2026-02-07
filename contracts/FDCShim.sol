// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./IFDCOracle.sol";

/**
 * @title FDCShim
 * @notice Simulated Flare Data Connector on-chain store.
 *
 * WHAT THIS SIMULATES:
 *   In production, Flare's FDC attestation providers independently verify
 *   Web2 API responses (e.g., UK carbon intensity) and submit Merkle proofs.
 *   The FDC verification contract on Flare stores the consensus result.
 *
 *   This shim replicates the *interface* so that FlexDAO.sol can query
 *   carbon intensity identically to how it would on Flare mainnet.
 *
 * KEY SCHEME:
 *   key = keccak256(abi.encodePacked(isoTimestamp))
 *   e.g. keccak256("2026-01-31T15:00Z")
 */
contract FDCShim is IFDCOracle {
    address public owner;
    mapping(bytes32 => uint256) private _intensities;
    mapping(bytes32 => bool) private _exists;
    uint256 private _count;

    event AttestationSubmitted(bytes32 indexed key, uint256 intensity);

    modifier onlyOwner() {
        require(msg.sender == owner, "FDCShim: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Submit an attestation (simulates FDC relay).
    function submitAttestation(bytes32 key, uint256 intensity) external onlyOwner {
        if (!_exists[key]) {
            _count++;
            _exists[key] = true;
        }
        _intensities[key] = intensity;
        emit AttestationSubmitted(key, intensity);
    }

    /// @inheritdoc IFDCOracle
    function getIntensity(bytes32 key) external view override returns (uint256) {
        require(_exists[key], "FDCShim: key not found");
        return _intensities[key];
    }

    /// @inheritdoc IFDCOracle
    function attestationCount() external view override returns (uint256) {
        return _count;
    }
}
