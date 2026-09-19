// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IRoleRegistry } from "./IRoleRegistry.sol";
import { IIdentityRegistry } from "./IIdentityRegistry.sol";
import { BelAccess, IRoleMask } from "./BelAccess.sol";
import { BelRoles } from "./BelRoles.sol";

/// @notice On-chain RBAC. Roles are stored against the persistent identity
/// (keccak256 of the DID), never against a wallet: the `identity` address
/// parameter of the frozen interface is resolved to its DID through
/// IdentityRegistry, so every wallet of an identity — including a future
/// replacement — carries the same roles (SYSTEM_SPEC "Roles belong to
/// persistent identity, not wallet").
///
/// `hasRole` answers the role question only; it does not check wallet
/// status. Access modifiers (BelAccess) check `isActiveWallet` separately.
contract RoleRegistry is IRoleRegistry, IRoleMask, BelAccess {
    error UnknownIdentity(address wallet);
    error RoleAlreadyAssigned(address wallet, Role role);
    error RoleNotAssigned(address wallet, Role role);
    error LastAdmin();

    mapping(bytes32 => uint256) private _roles;
    uint256 public adminCount;

    IIdentityRegistry private immutable _identity;

    /// @param identity_ the already-deployed IdentityRegistry.
    /// @param bootstrapAdminWallet must be the IdentityRegistry's bootstrap
    /// wallet; its identity receives ADMIN.
    constructor(address identity_, address bootstrapAdminWallet) {
        if (identity_ == address(0)) revert ZeroAddress();
        _identity = IIdentityRegistry(identity_);
        bytes32 key = _keyOf(bootstrapAdminWallet);
        if (key == bytes32(0)) revert UnknownIdentity(bootstrapAdminWallet);
        _roles[key] = BelRoles.ADMIN;
        adminCount = 1;
        emit RoleAssigned(bootstrapAdminWallet, Role.ADMIN);
    }

    /// ROLE_ASSIGN
    function assignRole(address identity, Role role) external onlyRoles(BelRoles.MANAGE_ROLES) {
        bytes32 key = _keyOf(identity);
        if (key == bytes32(0)) revert UnknownIdentity(identity);
        uint256 bit = _bit(role);
        if (_roles[key] & bit != 0) revert RoleAlreadyAssigned(identity, role);
        _roles[key] |= bit;
        if (role == Role.ADMIN) adminCount += 1;
        emit RoleAssigned(identity, role);
        _audit("IDENTITY", _identity.identityOf(identity), "ROLE_ASSIGN");
    }

    /// ROLE_REVOKE. The last ADMIN cannot be removed, or nobody could ever
    /// onboard or recover identities again.
    function revokeRole(address identity, Role role) external onlyRoles(BelRoles.MANAGE_ROLES) {
        bytes32 key = _keyOf(identity);
        if (key == bytes32(0)) revert UnknownIdentity(identity);
        uint256 bit = _bit(role);
        if (_roles[key] & bit == 0) revert RoleNotAssigned(identity, role);
        if (role == Role.ADMIN) {
            if (adminCount == 1) revert LastAdmin();
            adminCount -= 1;
        }
        _roles[key] &= ~bit;
        emit RoleRevoked(identity, role);
        _audit("IDENTITY", _identity.identityOf(identity), "ROLE_REVOKE");
    }

    function hasRole(address identity, Role role) external view returns (bool) {
        return _roles[_keyOf(identity)] & _bit(role) != 0;
    }

    function rolesOf(address wallet) external view returns (uint256) {
        return _roles[_keyOf(wallet)];
    }

    function rolesOfIdentity(string calldata did) external view returns (uint256) {
        return _roles[keccak256(bytes(did))];
    }

    function _rolesOf(address wallet) internal view override returns (uint256) {
        return _roles[_keyOf(wallet)];
    }

    /// @return keccak256(DID) for a known wallet, or 0 when unknown.
    function _keyOf(address wallet) private view returns (bytes32) {
        string memory did = _identity.identityOf(wallet);
        if (bytes(did).length == 0) return bytes32(0);
        return keccak256(bytes(did));
    }

    function _bit(Role role) private pure returns (uint256) {
        return 1 << uint8(role);
    }
}
