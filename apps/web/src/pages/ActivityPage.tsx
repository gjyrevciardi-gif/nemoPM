import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button, Spinner } from "../components/ui.js";
import { ActivityFeed } from "../components/ActivityFeed.js";

export default function ActivityPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const activityQuery = useQuery({
    queryKey: ["activity", projectId, 200],
    queryFn: () => api.listActivity(projectId!, 200),
    enabled: !!projectId,
  });

  const scanMutation = useMutation({
    mutationFn: () => api.scanGit(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Activity</h2>
        <Button variant="default" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
          {scanMutation.isPending ? "Scanning…" : "Scan Git activity"}
        </Button>
      </div>
      {scanMutation.data && (
        <p className="mb-4 text-sm text-ink-muted">
          {scanMutation.data.newCommitsDetected} new commit(s) detected
          {scanMutation.data.branchChanged ? " · branch changed" : ""}.
        </p>
      )}
      {scanMutation.isError && (
        <p className="mb-4 text-sm text-risk-high">{(scanMutation.error as Error).message}</p>
      )}
      <div className="card p-5">
        {activityQuery.isLoading ? (
          <div className="flex justify-center py-10 text-ink-faint">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <ActivityFeed activities={activityQuery.data ?? []} />
        )}
      </div>
    </div>
  );
}
