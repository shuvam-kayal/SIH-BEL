// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { DeployScript } from "../script/Deploy.s.sol";
import { ValidatorRegistry } from "../src/ValidatorRegistry.sol";

contract ValidatorRegistryTest is Test {
    function testAddRemoveRestoreAreHeightBoundAndHistoryIsAppendOnly() public {
        address admin = makeAddr("admin");
        address candidate = makeAddr("candidate");
        DeployScript.Deployment memory d = new DeployScript().deploy(admin, "DID:BEL:ADMIN");
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
        DeployScript.Deployment memory d = new DeployScript().deploy(admin, "DID:BEL:ADMIN");
        address[] memory bootstrap = d.validators.getValidators();
        vm.prank(admin);
        vm.expectRevert(ValidatorRegistry.InvalidValidator.selector);
        d.validators.removeValidator(bootstrap[0], uint64(block.number + 3), "retire");
    }
}
