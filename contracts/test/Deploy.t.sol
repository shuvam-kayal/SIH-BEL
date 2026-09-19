// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Test } from "forge-std/Test.sol";
import { DeployScript } from "../script/Deploy.s.sol";
import { IRoleRegistry } from "../src/IRoleRegistry.sol";

contract DeployTest is Test {
    function test_DeployProducesWiredUsableSystem() public {
        address admin = makeAddr("admin");
        DeployScript script = new DeployScript();
        DeployScript.Deployment memory d = script.deploy(admin, "DID:BEL:ADMIN");

        assertTrue(d.identity.wired() && d.roles.wired() && d.assets.wired() && d.jobs.wired());
        assertEq(address(d.assets.auditRegistry()), address(d.audit));
        assertTrue(d.audit.isRecorder(address(d.jobs)));
        assertTrue(d.roles.hasRole(admin, IRoleRegistry.Role.ADMIN));

        // The deployer keeps no powers after wiring.
        vm.expectRevert();
        vm.prank(address(script));
        d.assets.wire(address(1), address(1), address(1));

        vm.prank(admin);
        uint256 id = d.assets.mintAsset("ASSET-1", admin);
        assertEq(d.audit.getAuditTrail("ASSET-1").length, 1);
        assertEq(id, 1);
    }
}
