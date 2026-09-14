// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Immutable log of state-changing actions, referenced by
/// docs/DATA_MODEL.md's AuditEvent object. Other contracts should emit
/// here (or emit their own events that an off-chain indexer folds into
/// this shape) rather than let audit history live only in backend logs.
/// Sensitive documents stay off-chain per SYSTEM_SPEC.md — only hashes
/// and references are recorded here.
interface IAuditRegistry {
    event AuditRecorded(
        bytes32 indexed txId,
        string entityType, // ASSET | JOB | IDENTITY | WALLET
        string entityId,
        string action, // matches a CONTRACT_SPEC.md transaction type
        address indexed actor,
        uint256 timestamp
    );

    function recordAudit(
        string calldata entityType,
        string calldata entityId,
        string calldata action
    ) external returns (bytes32 txId);

    function getAuditTrail(string calldata entityId) external view returns (bytes32[] memory);
}
