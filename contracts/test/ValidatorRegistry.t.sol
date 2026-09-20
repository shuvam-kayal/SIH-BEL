// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { DeployScript } from "../script/Deploy.s.sol";
import { ValidatorRegistry } from "../src/ValidatorRegistry.sol";

contract ValidatorRegistryTest is Test {
    function testActivationAndRemovalAreHeightBound() public {
        address admin = makeAddr("admin");
        address candidate = makeAddr("candidate");
        DeployScript.Deployment memory d = new DeployScript().deploy(admin, "DID:BEL:ADMIN");
        vm.prank(admin);
        d.validators.registerValidator(candidate, "pub", "signing", uint64(block.number + 3));
        vm.roll(block.number + 2);
        assertEq(d.validators.getValidators().length, 1);
        vm.roll(block.number + 1);
        assertEq(d.validators.getValidators().length, 2);
        vm.prank(admin);
        d.validators.scheduleRemoval(candidate, uint64(block.number + 3), "retire");
        vm.roll(block.number + 2);
        assertEq(d.validators.getValidators().length, 2);
        vm.roll(block.number + 1);
        assertEq(d.validators.getValidators().length, 1);
    }
}
