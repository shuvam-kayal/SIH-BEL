// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { BelFixture } from "./utils/BelFixture.sol";
import { JobManager } from "../src/JobManager.sol";
import { IJobManager } from "../src/IJobManager.sol";

contract JobManagerTest is BelFixture {
    uint256 private nft;
    bytes32 private constant EVIDENCE = keccak256("report-v1");

    function setUp() public override {
        super.setUp();
        nft = mint("PUMP-001", admin);
    }

    function _status(string memory id) private view returns (JobManager.JobStatus) {
        return jobs.getJob(id).status;
    }

    function _invalid(string memory id, JobManager.JobStatus from, JobManager.JobStatus to)
        private
    {
        vm.expectRevert(abi.encodeWithSelector(JobManager.InvalidTransition.selector, id, from, to));
    }

    function test_HappyPathWithEvents() public {
        vm.expectEmit(true, true, true, true, address(jobs));
        emit JobCreated("J-1", nft, manager);
        vm.prank(manager);
        jobs.createJob("J-1", nft);
        assertEq(uint8(_status("J-1")), uint8(JobManager.JobStatus.CREATED));

        vm.expectEmit(true, true, true, true, address(jobs));
        emit JobAssigned("J-1", technician);
        vm.prank(manager);
        jobs.assignJob("J-1", technician);

        vm.expectEmit(true, true, true, true, address(jobs));
        emit JobStarted("J-1", technician);
        vm.prank(technician);
        jobs.startJob("J-1");

        vm.expectEmit(true, true, true, true, address(jobs));
        emit JobCompleted("J-1", EVIDENCE);
        vm.prank(technician);
        jobs.completeJob("J-1", EVIDENCE);

        vm.expectEmit(true, true, true, true, address(jobs));
        emit JobApproved("J-1", verifier);
        vm.prank(verifier);
        jobs.approveJob("J-1");

        JobManager.JobRecord memory j = jobs.getJob("J-1");
        assertEq(uint8(j.status), uint8(JobManager.JobStatus.VERIFIED));
        assertEq(j.evidenceHash, EVIDENCE);
        assertEq(j.verifier, verifier);
        assertEq(j.createdBy, manager);
        assertGt(j.completedAt, 0);
        assertGt(j.verifiedAt, 0);
    }

    function test_RejectThenReassignToDifferentTechnician() public {
        jobToCompleted("J-1", nft);
        vm.expectEmit(true, true, true, true, address(jobs));
        emit JobRejected("J-1", auditor, "torque values missing");
        vm.prank(auditor);
        jobs.rejectJob("J-1", "torque values missing");
        assertEq(uint8(_status("J-1")), uint8(JobManager.JobStatus.REJECTED));
        assertEq(jobs.getJob("J-1").rejectionCount, 1);
        assertEq(jobs.getJob("J-1").lastRejectionReason, "torque values missing");

        // Rework goes to the engineer this time.
        vm.prank(manager);
        jobs.assignJob("J-1", engineer);
        vm.prank(technician);
        vm.expectRevert(
            abi.encodeWithSelector(JobManager.NotAssignedTechnician.selector, technician)
        );
        jobs.startJob("J-1");

        vm.startPrank(engineer);
        jobs.startJob("J-1");
        jobs.completeJob("J-1", keccak256("report-v2"));
        vm.stopPrank();
        vm.prank(verifier);
        jobs.approveJob("J-1");
        assertEq(uint8(_status("J-1")), uint8(JobManager.JobStatus.VERIFIED));
    }

    function test_InvalidTransitions() public {
        vm.prank(manager);
        jobs.createJob("J-1", nft);

        // CREATED: cannot start, complete, approve, reject
        vm.prank(technician);
        _invalid("J-1", JobManager.JobStatus.CREATED, JobManager.JobStatus.IN_PROGRESS);
        jobs.startJob("J-1");
        vm.prank(verifier);
        _invalid("J-1", JobManager.JobStatus.CREATED, JobManager.JobStatus.VERIFIED);
        jobs.approveJob("J-1");

        vm.prank(manager);
        jobs.assignJob("J-1", technician);
        // ASSIGNED: cannot re-assign or complete
        vm.prank(manager);
        _invalid("J-1", JobManager.JobStatus.ASSIGNED, JobManager.JobStatus.ASSIGNED);
        jobs.assignJob("J-1", engineer);
        vm.prank(technician);
        _invalid("J-1", JobManager.JobStatus.ASSIGNED, JobManager.JobStatus.COMPLETED);
        jobs.completeJob("J-1", EVIDENCE);

        vm.prank(technician);
        jobs.startJob("J-1");
        // IN_PROGRESS: cannot approve/reject
        vm.prank(verifier);
        _invalid("J-1", JobManager.JobStatus.IN_PROGRESS, JobManager.JobStatus.REJECTED);
        jobs.rejectJob("J-1", "early");

        vm.prank(technician);
        jobs.completeJob("J-1", EVIDENCE);
        vm.prank(verifier);
        jobs.approveJob("J-1");
        // VERIFIED is terminal; approving again is a replay (THREAT_MODEL T8).
        vm.prank(verifier);
        _invalid("J-1", JobManager.JobStatus.VERIFIED, JobManager.JobStatus.VERIFIED);
        jobs.approveJob("J-1");
        vm.prank(manager);
        _invalid("J-1", JobManager.JobStatus.VERIFIED, JobManager.JobStatus.ASSIGNED);
        jobs.assignJob("J-1", technician);
    }

    function test_RevertWhen_InvalidCreate() public {
        vm.startPrank(manager);
        vm.expectRevert(JobManager.InvalidJobId.selector);
        jobs.createJob("", nft);
        vm.expectRevert(abi.encodeWithSelector(JobManager.AssetUnavailable.selector, 999));
        jobs.createJob("J-1", 999);
        jobs.createJob("J-1", nft);
        vm.expectRevert(abi.encodeWithSelector(JobManager.JobAlreadyExists.selector, "J-1"));
        jobs.createJob("J-1", nft);
        vm.stopPrank();
    }

    function test_RevertWhen_AssetDecommissioned() public {
        vm.prank(engineer);
        assets.changeAssetState(nft, "DECOMMISSIONED");
        vm.expectRevert(abi.encodeWithSelector(JobManager.AssetUnavailable.selector, nft));
        vm.prank(manager);
        jobs.createJob("J-1", nft);
    }

    function test_RevertWhen_UnknownJob() public {
        vm.expectRevert(abi.encodeWithSelector(JobManager.JobNotFound.selector, "nope"));
        vm.prank(manager);
        jobs.assignJob("nope", technician);
        vm.expectRevert(abi.encodeWithSelector(JobManager.JobNotFound.selector, "nope"));
        jobs.getJob("nope");
    }

    function test_RevertWhen_AssigneeInvalid() public {
        vm.prank(manager);
        jobs.createJob("J-1", nft);
        vm.startPrank(manager);
        // Auditor lacks PERFORM_MAINTENANCE.
        vm.expectRevert(abi.encodeWithSelector(JobManager.InvalidTechnician.selector, auditor));
        jobs.assignJob("J-1", auditor);
        vm.expectRevert(abi.encodeWithSelector(JobManager.InvalidTechnician.selector, outsider));
        jobs.assignJob("J-1", outsider);
        vm.expectRevert(abi.encodeWithSelector(JobManager.InvalidTechnician.selector, address(0)));
        jobs.assignJob("J-1", address(0));
        vm.stopPrank();

        vm.prank(admin);
        identity.revokeWallet(technician, "gone");
        vm.expectRevert(abi.encodeWithSelector(JobManager.InvalidTechnician.selector, technician));
        vm.prank(manager);
        jobs.assignJob("J-1", technician);
    }

    function test_OnlyAssignedTechnicianCanWork() public {
        vm.startPrank(manager);
        jobs.createJob("J-1", nft);
        jobs.assignJob("J-1", technician);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(JobManager.NotAssignedTechnician.selector, engineer));
        vm.prank(engineer);
        jobs.startJob("J-1");
    }

    function test_RevertWhen_EmptyEvidenceOrReason() public {
        vm.startPrank(manager);
        jobs.createJob("J-1", nft);
        jobs.assignJob("J-1", technician);
        vm.stopPrank();
        vm.startPrank(technician);
        jobs.startJob("J-1");
        vm.expectRevert(JobManager.InvalidEvidence.selector);
        jobs.completeJob("J-1", bytes32(0));
        jobs.completeJob("J-1", EVIDENCE);
        vm.stopPrank();
        vm.expectRevert(JobManager.InvalidReason.selector);
        vm.prank(verifier);
        jobs.rejectJob("J-1", "");
    }

    function test_EngineerCannotVerifyOwnWork() public {
        vm.startPrank(manager);
        jobs.createJob("J-1", nft);
        jobs.assignJob("J-1", engineer);
        vm.stopPrank();
        vm.startPrank(engineer);
        jobs.startJob("J-1");
        jobs.completeJob("J-1", EVIDENCE);
        vm.expectRevert(abi.encodeWithSelector(JobManager.VerifierIsTechnician.selector, engineer));
        jobs.approveJob("J-1");
        vm.expectRevert(abi.encodeWithSelector(JobManager.VerifierIsTechnician.selector, engineer));
        jobs.rejectJob("J-1", "self");
        vm.stopPrank();
    }

    function test_ReplacementWalletContinuesAssignedJob() public {
        vm.startPrank(manager);
        jobs.createJob("J-1", nft);
        jobs.assignJob("J-1", technician);
        vm.stopPrank();

        address replacement = makeAddr("tech-2");
        vm.startPrank(admin);
        identity.revokeWallet(technician, "replaced");
        identity.createIdentity(replacement, "DID:BEL:TECH");
        identity.activateWallet(replacement);
        vm.stopPrank();

        vm.prank(replacement);
        jobs.startJob("J-1");
        assertEq(uint8(_status("J-1")), uint8(JobManager.JobStatus.IN_PROGRESS));
    }
}
