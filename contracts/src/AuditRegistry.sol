// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IAuditRegistry } from "./IAuditRegistry.sol";
import { IIdentityRegistry } from "./IIdentityRegistry.sol";
import { IRoleRegistry } from "./IRoleRegistry.sol";
import { IAuditRecorder } from "./BelAccess.sol";

/// @notice Append-only audit log (THREAT_MODEL T9). There is no update or
/// delete path. Only hashes/identifiers are stored (ADR-005).
///
/// Writers:
///   - the four registries, fixed at construction (no setter, so nobody can
///     add a rogue recorder later), via `recordAuditFor` with the end-user
///     as actor;
///   - an ACTIVE ADMIN wallet, via the frozen `recordAudit`, for lifecycle
///     events that have no contract of their own (e.g. DEVICE, GRANT).
contract AuditRegistry is IAuditRegistry, IAuditRecorder {
    struct AuditRecord {
        string entityType;
        string entityId;
        string action;
        address actor;
        address recorder;
        uint64 timestamp;
        uint64 blockNumber;
    }

    error NotRecorder(address caller);
    error InvalidEntityType(string entityType);
    error InvalidEntityId();
    error InvalidAction();
    error RecordNotFound(bytes32 txId);
    error ZeroAddress();

    uint256 public constant MAX_FIELD_LENGTH = 128;

    IIdentityRegistry public immutable identityRegistry;
    IRoleRegistry public immutable roleRegistry;
    mapping(address => bool) public isRecorder;

    uint256 public recordCount;
    mapping(bytes32 => AuditRecord) private _records;
    mapping(bytes32 => bytes32[]) private _trails;

    constructor(address identity_, address roles_, address[] memory recorders) {
        if (identity_ == address(0) || roles_ == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(identity_);
        roleRegistry = IRoleRegistry(roles_);
        for (uint256 i = 0; i < recorders.length; i++) {
            if (recorders[i] == address(0)) revert ZeroAddress();
            isRecorder[recorders[i]] = true;
        }
    }

    function recordAudit(
        string calldata entityType,
        string calldata entityId,
        string calldata action
    ) external returns (bytes32 txId) {
        bool admin = identityRegistry.isActiveWallet(msg.sender)
            && roleRegistry.hasRole(msg.sender, IRoleRegistry.Role.ADMIN);
        if (!isRecorder[msg.sender] && !admin) revert NotRecorder(msg.sender);
        return _record(msg.sender, entityType, entityId, action);
    }

    function recordAuditFor(
        address actor,
        string calldata entityType,
        string calldata entityId,
        string calldata action
    ) external returns (bytes32 txId) {
        if (!isRecorder[msg.sender]) revert NotRecorder(msg.sender);
        return _record(actor, entityType, entityId, action);
    }

    function getAuditTrail(string calldata entityId) external view returns (bytes32[] memory) {
        return _trails[keccak256(bytes(entityId))];
    }

    function getAuditRecord(bytes32 txId) external view returns (AuditRecord memory r) {
        r = _records[txId];
        if (r.timestamp == 0) revert RecordNotFound(txId);
    }

    function _record(
        address actor,
        string calldata entityType,
        string calldata entityId,
        string calldata action
    ) private returns (bytes32 txId) {
        if (!_validEntityType(entityType)) {
            revert InvalidEntityType(entityType);
        }
        uint256 idLen = bytes(entityId).length;
        if (idLen == 0 || idLen > MAX_FIELD_LENGTH) revert InvalidEntityId();
        uint256 actLen = bytes(action).length;
        if (actLen == 0 || actLen > MAX_FIELD_LENGTH) revert InvalidAction();

        recordCount += 1;
        txId = keccak256(abi.encode(block.chainid, address(this), recordCount));
        _records[txId] = AuditRecord({
            entityType: entityType,
            entityId: entityId,
            action: action,
            actor: actor,
            recorder: msg.sender,
            timestamp: uint64(block.timestamp),
            blockNumber: uint64(block.number)
        });
        _trails[keccak256(bytes(entityId))].push(txId);
        emit AuditRecorded(txId, entityType, entityId, action, actor, block.timestamp);
    }

    /// shared/enums AUDIT_ENTITY_TYPES
    function _validEntityType(string calldata t) private pure returns (bool) {
        bytes32 h = keccak256(bytes(t));
        return h == keccak256("ASSET") || h == keccak256("JOB") || h == keccak256("IDENTITY")
            || h == keccak256("DEVICE") || h == keccak256("WALLET") || h == keccak256("GRANT");
    }
}
