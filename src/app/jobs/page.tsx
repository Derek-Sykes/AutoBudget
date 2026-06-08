import { requireCurrentUserId } from "@/server/currentUser";
import { getJobsView, type JobView } from "@/server/queries";
import { JobDialog } from "@/components/JobDialog";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PlusIcon } from "@/components/icons";
import { runCatchUpAction, setJobStatusAction } from "@/app/actions";
import { formatCents } from "@/domain/money";

export const dynamic = "force-dynamic";

const FREQ_LABEL: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  semimonthly: "Twice a month",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function JobsPage() {
  const userId = await requireCurrentUserId();
  const jobs = await getJobsView(userId);
  const active = jobs.filter((j) => j.status === "active");
  const paused = jobs.filter((j) => j.status === "paused");
  const archived = jobs.filter((j) => j.status === "archived");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jobs &amp; income</h1>
          <p className="text-sm text-muted">
            Recurring paychecks post automatically when each pay date arrives.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            label="Check now"
            className="btn-secondary"
            action={runCatchUpAction}
            hidden={{}}
          />
          <JobDialog
            mode="create"
            triggerClassName="btn-primary"
            triggerLabel={
              <>
                <PlusIcon className="h-4 w-4" /> Add income source
              </>
            }
          />
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-muted">No income sources yet.</p>
          <JobDialog mode="create" triggerClassName="btn-primary" triggerLabel="Add income source" />
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              {active.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </section>
          )}

          {paused.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Paused</h2>
              {paused.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </section>
          )}

          {archived.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Archived</h2>
              {archived.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function JobCard({ job }: { job: JobView }) {
  const small = "px-3 py-1.5 text-xs";
  return (
    <div className={`card ${job.status === "archived" ? "opacity-70" : ""}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{job.name}</h3>
            {job.status === "paused" && <span className="badge bg-amber-50 text-warn">Paused</span>}
            {job.status === "archived" && (
              <span className="badge bg-slate-100 text-slate-600">Archived</span>
            )}
            {job.status === "active" &&
              (job.autoDisperse ? (
                <span className="badge bg-brand-50 text-brand-700">Auto-disperse</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-600">→ Free to Spend</span>
              ))}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {formatCents(job.amountCents)} · {FREQ_LABEL[job.payFrequency] ?? job.payFrequency}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{formatCents(job.monthlyIncomeCents)}</p>
          <p className="text-xs text-muted">est. / month</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Stat label="Next paycheck" value={job.status === "active" ? fmtDate(job.nextPayDate) : "—"} />
        <Stat label="Last paycheck" value={fmtDate(job.lastPaidDate)} />
        <Stat
          label="Auto-disperse"
          value={job.autoDisperse ? "On (funding plan)" : "Off (Free to Spend)"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {job.status !== "archived" && (
          <JobDialog mode="edit" job={job} triggerClassName={`btn-secondary ${small}`} triggerLabel="Edit" />
        )}
        {job.status === "active" && (
          <ConfirmButton
            label="Pause"
            className={`btn-ghost ${small}`}
            action={setJobStatusAction}
            hidden={{ jobId: job.id, status: "paused" }}
          />
        )}
        {(job.status === "paused" || job.status === "archived") && (
          <ConfirmButton
            label="Resume"
            className={`btn-ghost ${small}`}
            action={setJobStatusAction}
            hidden={{ jobId: job.id, status: "active" }}
          />
        )}
        {job.status !== "archived" && (
          <ConfirmButton
            label="Archive"
            className={`btn-ghost ${small}`}
            confirmText={`Archive "${job.name}"? It stops generating paychecks. Its history is kept.`}
            action={setJobStatusAction}
            hidden={{ jobId: job.id, status: "archived" }}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
