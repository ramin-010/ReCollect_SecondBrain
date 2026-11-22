package app.recollect.phone;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;

/** The scheduled refresh (Schedule): runs off the main thread, then chains the next one. */
public final class RefreshJob extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context app = getApplicationContext();
        new Thread(() -> {
            try {
                Refresher.Outcome out = Refresher.run(app, false);
                if (out.revoked) Session.forget(app);
            } finally {
                // Finish first: scheduling the same job id while it still runs would stop it.
                jobFinished(params, false);
                Schedule.next(app);
            }
        }, "recollect-refresh").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // The thread finishes on its own and schedules the next refresh.
        return false;
    }
}
