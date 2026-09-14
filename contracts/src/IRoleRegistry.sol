// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Backs docs/RBAC_MATRIX.md on-chain. Roles belong to the
/// persistent identity, not the wallet — see SYSTEM_SPEC.md security
/// assumptions. Other contracts (AssetRegistry, JobManager) should call
/// `hasRole` in their own access-control modifiers rather than
/// duplicating role storage.
interface IRoleRegistry {
    enum Role {
        ADMIN,
        MANAGER,
        ENGINEER,
        TECHNICIAN,
        AUDITOR,
        ISSUER,
        VERIFIER
    }

    event RoleAssigned(address indexed identity, Role role);
    event RoleRevoked(address indexed identity, Role role);

    // ROLE_ASSIGN / ROLE_REVOKE transaction events are authoritative for RBAC audit history.

    function assignRole(address identity, Role role) external;
    function revokeRole(address identity, Role role) external;
    function hasRole(address identity, Role role) external view returns (bool);
}
