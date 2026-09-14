// Owner: Person 6. Backs GET /jobs, POST /jobs.

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import { Job } from "../../../shared/types";

export function JobsPage({ onSelect }: { onSelect?: (jobId: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    mockApi.getJobs().then(setJobs);
  }, []);

  return (
    <div>
      <h2>Jobs</h2>
      <ul>
        {jobs.map((j) => (
          <li key={j.jobId}>
            <button onClick={() => onSelect?.(j.jobId)}>
              {j.jobId} — {j.status} — priority {j.priority}
            </button>
          </li>
        ))}
      </ul>
      {/* TODO: create-job form (RBAC: Manager/Engineer only) */}
    </div>
  );
}
