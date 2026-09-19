// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IIdentityRegistry } from "./IIdentityRegistry.sol";
import { IRoleRegistry } from "./IRoleRegistry.sol";

/// @notice Role bitmask lookup exposed by RoleRegistry in addition to the
/// frozen IRoleRegistry.hasRole, so a modifier needs one call, not seven.
interface IRoleMask {
    function rolesOf(address wallet) external view returns (uint256);
}

/// @notice Attributed audit recording used by the registries. Separate from
/// the frozen IAuditRegistry.recordAudit because, when a registry records
/// on behalf of a user, msg.sender is the registry contract, not the user.
interface IAuditRecorder {
    function recordAuditFor(
        address actor,
        string calldata entityType,
        string calldata entityId,
        string calldata action
    ) external returns (bytes32 txId);
}

/// @notice Common access control for every BEL registry (ADR-008: contracts
/// are the trust boundary, independent of backend RBAC).
///
/// Every protected call checks, in order:
///   1. the registry set is wired (fail closed before deployment completes);
///   2. msg.sender is an ACTIVE wallet (SYSTEM_SPEC: a revoked wallet must
///      not transact regardless of the role its identity holds);
///   3. the caller's identity holds at least one role in the required mask.
///
/// Wiring is a one-time deploy step because the contracts reference each
/// other (IdentityRegistry needs RoleRegistry for ADMIN checks, and every
/// registry records into AuditRegistry, which is deployed last). After
/// `wire` the deployer has no remaining privileges.
abstract contract BelAccess {
    error Unauthorized(address caller, uint256 requiredRoles);
    error InactiveWallet(address wallet);
    error NotWired();
    error AlreadyWired();
    error NotDeployer();
    error ZeroAddress();

    event Wired(address identityRegistry, address roleRegistry, address auditRegistry);

    address public immutable deployer;
    bool public wired;
    IIdentityRegistry public identityRegistry;
    IRoleRegistry public roleRegistry;
    IAuditRecorder public auditRegistry;

    constructor() {
        deployer = msg.sender;
    }

    function wire(address identity_, address roles_, address audit_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (wired) revert AlreadyWired();
        if (identity_ == address(0) || roles_ == address(0) || audit_ == address(0)) {
            revert ZeroAddress();
        }
        identityRegistry = IIdentityRegistry(identity_);
        roleRegistry = IRoleRegistry(roles_);
        auditRegistry = IAuditRecorder(audit_);
        wired = true;
        emit Wired(identity_, roles_, audit_);
    }

    modifier onlyRoles(uint256 requiredRoles) {
        _checkRoles(msg.sender, requiredRoles);
        _;
    }

    function _checkRoles(address caller, uint256 requiredRoles) internal view {
        if (!wired) revert NotWired();
        if (!_isActive(caller)) revert InactiveWallet(caller);
        if (_rolesOf(caller) & requiredRoles == 0) revert Unauthorized(caller, requiredRoles);
    }

    /// Overridden by IdentityRegistry to avoid an external self-call.
    function _isActive(address wallet) internal view virtual returns (bool) {
        return identityRegistry.isActiveWallet(wallet);
    }

    /// Overridden by RoleRegistry to avoid an external self-call.
    function _rolesOf(address wallet) internal view virtual returns (uint256) {
        return IRoleMask(address(roleRegistry)).rolesOf(wallet);
    }

    function _hasAnyRole(address wallet, uint256 mask) internal view returns (bool) {
        return _rolesOf(wallet) & mask != 0;
    }

    function _audit(string memory entityType, string memory entityId, string memory action)
        internal
    {
        auditRegistry.recordAuditFor(msg.sender, entityType, entityId, action);
    }
}
