// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IValidatorRegistry {
    struct ValidatorRecord {
        bool registered;
        address validator;
        string publicKey;
        string signingPublicKey;
        uint64 activationHeight;
        uint64 removalHeight;
        uint64 registeredAt;
    }
    function getValidators() external view returns (address[] memory);
    function getValidator(address validator) external view returns (ValidatorRecord memory);
    function validatorCountAt(uint256 height) external view returns (uint256);
    function publicKeyOf(address validator) external view returns (string memory);
    function signingPublicKeyOf(address validator) external view returns (string memory);
    function activationHeightOf(address validator) external view returns (uint64);
    function removalHeightOf(address validator) external view returns (uint64);
    function addValidator(address validator, string calldata publicKey, string calldata signingPublicKey, uint64 activationHeight) external;
    function removeValidator(address validator, uint64 removalHeight, string calldata reason) external;
    function restoreValidator(address validator, string calldata reason) external;
    function cancelScheduledRemoval(address validator, string calldata reason) external;
}

