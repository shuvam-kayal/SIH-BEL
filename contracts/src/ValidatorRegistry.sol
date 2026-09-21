// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { BelAccess } from "./BelAccess.sol";
import { BelRoles } from "./BelRoles.sol";
import { IValidatorRegistry } from "./IValidatorRegistry.sol";

/// @notice Canonical application-managed validator state after genesis.
/// Bootstrap validators are permanent infrastructure validators. They remain
/// in the QBFT bootstrap set and cannot be removed by application governance.
/// Every ADD, REMOVE, and RESTORE is an event; no prior operation is deleted.
contract ValidatorRegistry is BelAccess, IValidatorRegistry {
    error InvalidValidator();
    error AlreadyRegistered(address validator);
    error NotRegistered(address validator);
    error InvalidHeight();
    error PopulationBelowMinimum(uint256 height, uint256 population);
    error InvalidKeyMaterial();

    uint256 public immutable minimumPopulation;
    mapping(address => ValidatorRecord) private _records;
    address[] private _validators;
    address[] private _bootstrapValidators;
    mapping(address => bool) private _isBootstrap;

    event ValidatorAdded(address indexed validator, uint64 activationHeight, string publicKey, string signingPublicKey);
    event ValidatorRemoved(address indexed validator, uint64 removalHeight, string reason);
    event ValidatorRestored(address indexed validator, uint64 previousRemovalHeight, string reason);

    constructor(uint256 minimumPopulation_, address[] memory bootstrapValidators) {
        if (minimumPopulation_ == 0 || bootstrapValidators.length < minimumPopulation_) revert InvalidHeight();
        minimumPopulation = minimumPopulation_;
        for (uint256 i = 0; i < bootstrapValidators.length; i++) {
            if (bootstrapValidators[i] == address(0)) revert InvalidValidator();
            if (_isBootstrap[bootstrapValidators[i]]) revert InvalidValidator();
            _bootstrapValidators.push(bootstrapValidators[i]);
            _isBootstrap[bootstrapValidators[i]] = true;
        }
    }

    function addValidator(
        address validator,
        string calldata publicKey,
        string calldata signingPublicKey,
        uint64 activationHeight
    ) external onlyRoles(BelRoles.ADMIN) {
        if (validator == address(0) || _isBootstrap[validator] || bytes(publicKey).length == 0 || bytes(signingPublicKey).length == 0) revert InvalidValidator();
        if (bytes(publicKey).length > 256 || bytes(signingPublicKey).length > 256) revert InvalidKeyMaterial();
        if (activationHeight <= block.number) revert InvalidHeight();
        ValidatorRecord storage current = _records[validator];
        if (current.registered) revert AlreadyRegistered(validator);
        current.registered = true;
        current.validator = validator;
        current.publicKey = publicKey;
        current.signingPublicKey = signingPublicKey;
        current.activationHeight = activationHeight;
        current.removalHeight = 0;
        current.registeredAt = uint64(block.number);
        _validators.push(validator);
        emit ValidatorAdded(validator, activationHeight, publicKey, signingPublicKey);
        _audit("VALIDATOR", _id(validator), "VALIDATOR_ADD");
    }

    function removeValidator(address validator, uint64 removalHeight, string calldata reason)
        external onlyRoles(BelRoles.ADMIN)
    {
        ValidatorRecord storage current = _records[validator];
        if (!current.registered) revert NotRegistered(validator);
        if (removalHeight <= block.number || removalHeight <= current.activationHeight) revert InvalidHeight();
        if (_isBootstrap[validator]) revert InvalidValidator();
        if (validatorCountAt(removalHeight) < minimumPopulation) revert PopulationBelowMinimum(removalHeight, validatorCountAt(removalHeight));
        current.removalHeight = removalHeight;
        emit ValidatorRemoved(validator, removalHeight, reason);
        _audit("VALIDATOR", _id(validator), "VALIDATOR_REMOVE");
    }

    /// @notice Inverse recovery operation. It clears only the current
    /// effective boundary; the prior ValidatorRemoved event remains on-chain.
    function restoreValidator(address validator, string calldata reason)
        external onlyRoles(BelRoles.ADMIN)
    {
        ValidatorRecord storage current = _records[validator];
        if (!current.registered) revert NotRegistered(validator);
        if (_isBootstrap[validator]) revert InvalidValidator();
        if (current.removalHeight == 0) revert AlreadyRegistered(validator);
        uint64 previousRemovalHeight = current.removalHeight;
        current.removalHeight = 0;
        emit ValidatorRestored(validator, previousRemovalHeight, reason);
        _audit("VALIDATOR", _id(validator), "VALIDATOR_RESTORE");
    }

    function getValidators() external view returns (address[] memory) {
        return _activeAt(block.number);
    }

    function getValidatorsAt(uint256 height) external view returns (address[] memory) {
        return _activeAt(height);
    }

    function getValidator(address validator) external view returns (ValidatorRecord memory) { return _records[validator]; }
    function publicKeyOf(address validator) external view returns (string memory) { return _records[validator].publicKey; }
    function signingPublicKeyOf(address validator) external view returns (string memory) { return _records[validator].signingPublicKey; }
    function activationHeightOf(address validator) external view returns (uint64) { return _records[validator].activationHeight; }
    function removalHeightOf(address validator) external view returns (uint64) { return _records[validator].removalHeight; }

    function validatorCountAt(uint256 height) public view returns (uint256) {
        uint256 count = _bootstrapValidators.length;
        for (uint256 i = 0; i < _validators.length; i++) if (_isActive(_records[_validators[i]], height)) count++;
        return count;
    }

    function _activeAt(uint256 height) private view returns (address[] memory) {
        uint256 count = validatorCountAt(height);
        address[] memory result = new address[](count);
        uint256 j;
        for (uint256 i = 0; i < _validators.length; i++) {
            address validator = _validators[i];
            if (_isActive(_records[validator], height)) result[j++] = validator;
        }
        return result;
    }

    function _isActive(ValidatorRecord memory record, uint256 height) private pure returns (bool) {
        return record.registered && record.activationHeight <= height && (record.removalHeight == 0 || height < record.removalHeight);
    }

    function _id(address validator) private pure returns (string memory) {
        return vmHex(validator);
    }

    function vmHex(address value) private pure returns (string memory) {
        bytes memory symbols = "0123456789abcdef";
        bytes memory buffer = new bytes(42);
        buffer[0] = "0"; buffer[1] = "x";
        uint160 data = uint160(value);
        for (uint256 i = 0; i < 20; i++) {
            buffer[2 + i * 2] = symbols[data >> (8 * (19 - i) + 4) & 0xf];
            buffer[3 + i * 2] = symbols[data >> (8 * (19 - i)) & 0xf];
        }
        return string(buffer);
    }
}



