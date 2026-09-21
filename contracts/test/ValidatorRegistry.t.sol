// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { DeployScript } from "../script/Deploy.s.sol";
import { ValidatorRegistry } from "../src/ValidatorRegistry.sol";

contract ValidatorRegistryTest is Test {
    function testAddRemoveRestoreAreHeightBoundAndHistoryIsAppendOnly() public {
        address admin = makeAddr("admin");
        address candidate = makeAddr("candidate");
        address[] memory bootstrap = _bootstrap(admin);
        DeployScript.Deployment memory d = new DeployScript().deployWithBootstrap(admin, "DID:BEL:ADMIN", bootstrap);
        vm.prank(admin);
        d.validators.addValidator(candidate, "pub", "signing", uint64(block.number + 3));
        vm.roll(block.number + 2);
        assertEq(d.validators.getValidators().length, 1);
        vm.roll(block.number + 1);
        assertEq(d.validators.getValidators().length, 2);
        vm.prank(admin);
        d.validators.removeValidator(candidate, uint64(block.number + 3), "retire");
        vm.roll(block.number + 2);
        assertEq(d.validators.getValidators().length, 2);
        vm.roll(block.number + 1);
        assertEq(d.validators.getValidators().length, 1);
        vm.prank(admin);
        d.validators.restoreValidator(candidate, "recovery");
        assertEq(d.validators.getValidators().length, 2);
    }

    function testBootstrapValidatorsCannotBeRemoved() public {
        address admin = makeAddr("admin");
        DeployScript.Deployment memory d = new DeployScript().deployWithBootstrap(admin, "DID:BEL:ADMIN", _bootstrap(admin));
        address[] memory bootstrap = d.validators.getValidators();
        vm.prank(admin);
        vm.expectRevert(ValidatorRegistry.InvalidValidator.selector);
        d.validators.removeValidator(bootstrap[0], uint64(block.number + 3), "retire");
    }

    function testScheduledRemovalCanBeCancelledBeforeEffectiveHeight() public {
        address admin = makeAddr("admin");
        address candidate = makeAddr("candidate");
        DeployScript.Deployment memory d = new DeployScript().deployWithBootstrap(admin, "DID:BEL:ADMIN", _bootstrap(admin));
        vm.prank(admin);
        d.validators.addValidator(candidate, "pub", "signing", uint64(block.number + 1));
        vm.roll(block.number + 1);
        vm.prank(admin);
        d.validators.removeValidator(candidate, uint64(block.number + 5), "retire");
        vm.prank(admin);
        d.validators.cancelScheduledRemoval(candidate, "retain");
        assertEq(d.validators.getValidators().length, 71);
    }

    function testRestoreRejectsRemovalThatIsNotEffective() public {
        address admin = makeAddr("admin");
        address candidate = makeAddr("candidate");
        DeployScript.Deployment memory d = new DeployScript().deployWithBootstrap(admin, "DID:BEL:ADMIN", _bootstrap(admin));
        vm.prank(admin);
        d.validators.addValidator(candidate, "pub", "signing", uint64(block.number + 1));
        vm.roll(block.number + 1);
        vm.prank(admin);
        d.validators.removeValidator(candidate, uint64(block.number + 5), "retire");
        vm.prank(admin);
        vm.expectRevert(ValidatorRegistry.RemovalNotEffective.selector);
        d.validators.restoreValidator(candidate, "too soon");
    }

    function _bootstrap(address admin) internal returns (address[] memory validators) {
        validators = new address[](70);
        validators[0] = admin;
        for (uint256 i = 1; i < validators.length; i++) {
            validators[i] = makeAddr(string.concat("validator-", vm.toString(i)));
        }
    }
}
