// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Maintenance job lifecycle. The on-chain state machine must
/// match the one enforced in backend/src/jobs/jobs.service.ts:
///   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
///                                             \-> REJECTED -> ASSIGNED
/// Maintenance evidence (photos, reports) stays off-chain per
/// SYSTEM_SPEC.md; only its hash is recorded.
interface IJobManager {
    /// JOB_CREATE
    event JobCreated(string jobId, uint256 indexed assetNftId, address indexed createdBy);
    /// JOB_ASSIGN
    event JobAssigned(string jobId, address indexed technician);
    /// JOB_START
    event JobStarted(string jobId, address indexed technician);
    /// JOB_COMPLETE
    event JobCompleted(string jobId, bytes32 evidenceHash);
    /// JOB_APPROVE
    event JobApproved(string jobId, address indexed verifier);
    /// JOB_REJECT
    event JobRejected(string jobId, address indexed verifier, string reason);

    function createJob(string calldata jobId, uint256 assetNftId) external;

    function assignJob(string calldata jobId, address technician) external;

    function startJob(string calldata jobId) external;

    /// @param evidenceHash hash of the off-chain completion record.
    function completeJob(string calldata jobId, bytes32 evidenceHash) external;

    function approveJob(string calldata jobId) external;

    function rejectJob(string calldata jobId, string calldata reason) external;
}
