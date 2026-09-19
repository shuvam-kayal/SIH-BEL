// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IRoleRegistry } from "./IRoleRegistry.sol";

/// @notice On-chain mirror of docs/RBAC_MATRIX.md / shared/rbac/index.ts.
/// Each constant is a bitmask of the roles for which that action is
/// ALLOW. Bit i corresponds to IRoleRegistry.Role(i).
///
/// AUTH / OWN cells are NOT folded into these masks:
///   - TRANSFER_ASSET for ENGINEER is `auth`. The frozen interfaces have
///     no grant-verification function yet, so the contract fails closed
///     (same as backend/src/routes/assets.routes.ts today).
///   - PERFORM_MAINTENANCE additionally requires being the assigned
///     technician (enforced in JobManager).
/// Changing a mask here requires the same team approval as changing the
/// matrix itself (docs/BASELINE_FREEZE.md).
library BelRoles {
    uint256 internal constant ADMIN = 1 << uint8(IRoleRegistry.Role.ADMIN);
    uint256 internal constant MANAGER = 1 << uint8(IRoleRegistry.Role.MANAGER);
    uint256 internal constant ENGINEER = 1 << uint8(IRoleRegistry.Role.ENGINEER);
    uint256 internal constant TECHNICIAN = 1 << uint8(IRoleRegistry.Role.TECHNICIAN);
    uint256 internal constant AUDITOR = 1 << uint8(IRoleRegistry.Role.AUDITOR);
    uint256 internal constant ISSUER = 1 << uint8(IRoleRegistry.Role.ISSUER);
    uint256 internal constant VERIFIER = 1 << uint8(IRoleRegistry.Role.VERIFIER);

    // --- RBAC_MATRIX.md rows (ALLOW cells only) ---
    uint256 internal constant CREATE_EMPLOYEE = ADMIN;
    uint256 internal constant REVOKE_WALLET = ADMIN;
    uint256 internal constant ACTIVATE_WALLET = ADMIN | ISSUER;
    uint256 internal constant REGISTER_ASSET = ADMIN | MANAGER | ENGINEER | ISSUER;
    uint256 internal constant CREATE_JOB = MANAGER | ENGINEER;
    uint256 internal constant ASSIGN_TECHNICIAN = MANAGER | ENGINEER;
    uint256 internal constant PERFORM_MAINTENANCE = ENGINEER | TECHNICIAN;
    uint256 internal constant VERIFY_MAINTENANCE = MANAGER | ENGINEER | AUDITOR | VERIFIER;
    uint256 internal constant TRANSFER_ASSET = ADMIN | MANAGER;

    // --- Actions with no matrix row (documented choices, see contracts/README.md) ---
    /// Role assignment/revocation is an administrator verification step
    /// (RBAC_MATRIX.md "Lifecycle enforcement notes").
    uint256 internal constant MANAGE_ROLES = ADMIN;
    /// Asset state change and component attach/remove reuse the
    /// "Register asset" row: the same people who put an asset into the
    /// system manage its lifecycle and hierarchy.
    uint256 internal constant MANAGE_ASSET = REGISTER_ASSET;
}
