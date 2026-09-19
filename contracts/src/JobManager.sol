// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IJobManager } from "./IJobManager.sol";
import { AssetRegistry } from "./AssetRegistry.sol";
import { BelAccess } from "./BelAccess.sol";
import { BelRoles } from "./BelRoles.sol";

/// @notice Maintenance job state machine. Must match
/// backend/src/jobs/jobs.service.ts ALLOWED_TRANSITIONS:
///   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
///                                             \-> REJECTED -> ASSIGNED
///
/// Assignment is tracked by identity (DID), not wallet, so a technician whose
/// wallet is replaced mid-job can continue with the new wallet (ADR-020).
/// Evidence stays off-chain; only its hash is recorded (ADR-005).
contract JobManager is IJobManager, BelAccess {
    enum JobStatus {
        NONE,
        CREATED,
        ASSIGNED,
        IN_PROGRESS,
        COMPLETED,
        VERIFIED,
        REJECTED
    }

    struct JobRecord {
        string jobId;
        uint256 assetNftId;
        address createdBy;
        address technician;
        bytes32 technicianKey;
        address verifier;
        JobStatus status;
        bytes32 evidenceHash;
        uint64 createdAt;
        uint64 completedAt;
        uint64 verifiedAt;
        uint32 rejectionCount;
        string lastRejectionReason;
    }

    error InvalidJobId();
    error JobAlreadyExists(string jobId);
    error JobNotFound(string jobId);
    error AssetUnavailable(uint256 assetNftId);
    error InvalidTransition(string jobId, JobStatus from, JobStatus to);
    error InvalidTechnician(address technician);
    error NotAssignedTechnician(address caller);
    error InvalidEvidence();
    error InvalidReason();
    error VerifierIsTechnician(address verifier);

    uint256 public constant MAX_JOB_ID_LENGTH = 128;
    uint256 public constant MAX_REASON_LENGTH = 256;

    AssetRegistry public immutable assets;
    mapping(bytes32 => JobRecord) private _jobs;

    constructor(address assetRegistry) {
        if (assetRegistry == address(0)) revert ZeroAddress();
        assets = AssetRegistry(assetRegistry);
    }

    /// JOB_CREATE
    function createJob(string calldata jobId, uint256 assetNftId)
        external
        onlyRoles(BelRoles.CREATE_JOB)
    {
        uint256 len = bytes(jobId).length;
        if (len == 0 || len > MAX_JOB_ID_LENGTH) revert InvalidJobId();
        bytes32 key = keccak256(bytes(jobId));
        if (_jobs[key].status != JobStatus.NONE) revert JobAlreadyExists(jobId);
        if (!assets.exists(assetNftId)) revert AssetUnavailable(assetNftId);
        if (keccak256(bytes(assets.stateOf(assetNftId))) == keccak256("DECOMMISSIONED")) {
            revert AssetUnavailable(assetNftId);
        }

        JobRecord storage j = _jobs[key];
        j.jobId = jobId;
        j.assetNftId = assetNftId;
        j.createdBy = msg.sender;
        j.status = JobStatus.CREATED;
        j.createdAt = uint64(block.timestamp);
        emit JobCreated(jobId, assetNftId, msg.sender);
        _audit("JOB", jobId, "JOB_CREATE");
    }

    /// JOB_ASSIGN. CREATED -> ASSIGNED, or REJECTED -> ASSIGNED (re-work,
    /// possibly to a different technician). The assignee must be an ACTIVE
    /// wallet whose identity may perform maintenance.
    function assignJob(string calldata jobId, address technician)
        external
        onlyRoles(BelRoles.ASSIGN_TECHNICIAN)
    {
        JobRecord storage j = _existing(jobId);
        if (j.status != JobStatus.CREATED && j.status != JobStatus.REJECTED) {
            revert InvalidTransition(jobId, j.status, JobStatus.ASSIGNED);
        }
        if (
            technician == address(0) || !identityRegistry.isActiveWallet(technician)
                || !_hasAnyRole(technician, BelRoles.PERFORM_MAINTENANCE)
        ) revert InvalidTechnician(technician);

        j.technician = technician;
        j.technicianKey = keccak256(bytes(identityRegistry.identityOf(technician)));
        j.status = JobStatus.ASSIGNED;
        emit JobAssigned(jobId, technician);
        _audit("JOB", jobId, "JOB_ASSIGN");
    }

    /// JOB_START. Only the assigned technician (RBAC `own` semantics).
    function startJob(string calldata jobId) external onlyRoles(BelRoles.PERFORM_MAINTENANCE) {
        JobRecord storage j = _existing(jobId);
        if (j.status != JobStatus.ASSIGNED) {
            revert InvalidTransition(jobId, j.status, JobStatus.IN_PROGRESS);
        }
        _requireAssignee(j);
        j.status = JobStatus.IN_PROGRESS;
        emit JobStarted(jobId, msg.sender);
        _audit("JOB", jobId, "JOB_START");
    }

    /// JOB_COMPLETE. Anchors the hash of the off-chain maintenance record.
    function completeJob(string calldata jobId, bytes32 evidenceHash)
        external
        onlyRoles(BelRoles.PERFORM_MAINTENANCE)
    {
        JobRecord storage j = _existing(jobId);
        if (j.status != JobStatus.IN_PROGRESS) {
            revert InvalidTransition(jobId, j.status, JobStatus.COMPLETED);
        }
        _requireAssignee(j);
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        j.status = JobStatus.COMPLETED;
        j.evidenceHash = evidenceHash;
        j.completedAt = uint64(block.timestamp);
        emit JobCompleted(jobId, evidenceHash);
        _audit("JOB", jobId, "JOB_COMPLETE");
    }

    /// JOB_APPROVE. COMPLETED -> VERIFIED (terminal).
    function approveJob(string calldata jobId) external onlyRoles(BelRoles.VERIFY_MAINTENANCE) {
        JobRecord storage j = _existing(jobId);
        if (j.status != JobStatus.COMPLETED) {
            revert InvalidTransition(jobId, j.status, JobStatus.VERIFIED);
        }
        _requireIndependentVerifier(j);
        j.status = JobStatus.VERIFIED;
        j.verifier = msg.sender;
        j.verifiedAt = uint64(block.timestamp);
        emit JobApproved(jobId, msg.sender);
        _audit("JOB", jobId, "JOB_APPROVE");
    }

    /// JOB_REJECT. COMPLETED -> REJECTED (non-terminal; re-enter via assignJob).
    function rejectJob(string calldata jobId, string calldata reason)
        external
        onlyRoles(BelRoles.VERIFY_MAINTENANCE)
    {
        uint256 len = bytes(reason).length;
        if (len == 0 || len > MAX_REASON_LENGTH) revert InvalidReason();
        JobRecord storage j = _existing(jobId);
        if (j.status != JobStatus.COMPLETED) {
            revert InvalidTransition(jobId, j.status, JobStatus.REJECTED);
        }
        _requireIndependentVerifier(j);
        j.status = JobStatus.REJECTED;
        j.verifier = msg.sender;
        j.rejectionCount += 1;
        j.lastRejectionReason = reason;
        emit JobRejected(jobId, msg.sender, reason);
        _audit("JOB", jobId, "JOB_REJECT");
    }

    // ----------------------------------------------------------------- views

    function getJob(string calldata jobId) external view returns (JobRecord memory) {
        return _existing(jobId);
    }

    function jobExists(string calldata jobId) external view returns (bool) {
        return _jobs[keccak256(bytes(jobId))].status != JobStatus.NONE;
    }

    // -------------------------------------------------------------- internal

    function _existing(string calldata jobId) private view returns (JobRecord storage j) {
        j = _jobs[keccak256(bytes(jobId))];
        if (j.status == JobStatus.NONE) revert JobNotFound(jobId);
    }

    function _callerKey() private view returns (bytes32) {
        return keccak256(bytes(identityRegistry.identityOf(msg.sender)));
    }

    function _requireAssignee(JobRecord storage j) private view {
        if (_callerKey() != j.technicianKey) revert NotAssignedTechnician(msg.sender);
    }

    /// Separation of duties: nobody verifies their own maintenance work.
    function _requireIndependentVerifier(JobRecord storage j) private view {
        if (_callerKey() == j.technicianKey) revert VerifierIsTechnician(msg.sender);
    }
}
