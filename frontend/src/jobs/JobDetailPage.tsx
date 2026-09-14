// Owner: Person 6. Backs the /jobs/:id/{assign,start,complete,approve,
// reject} action endpoints. Buttons shown should be gated per
// docs/RBAC_MATRIX.md and the job's current status — see the state
// machine in backend/src/jobs/jobs.service.ts.

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import { Job } from "../../../shared/types";

export function JobDetailPage({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    mockApi.getJobs().then((jobs) => setJob(jobs.find((j) => j.jobId === jobId) ?? null));
  }, [jobId]);

  if (!job) return <p>Loading...</p>;

  return (
    <div>
      <h2>{job.jobId}</h2>
      <p>Asset: {job.assetId}</p>
      <p>Status: {job.status}</p>
      <p>Assigned to: {job.assignedTo || "Unassigned"}</p>
      {/* TODO: action buttons wired to mockApi.assignJob/startJob/
          completeJob/approveJob/rejectJob, shown/hidden by role + status */}
    </div>
  );
}
