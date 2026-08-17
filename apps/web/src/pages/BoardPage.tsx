import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Issue, IssueStatus } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Spinner } from "../components/ui.js";
import { IssueCard } from "../components/IssueCard.js";
import { CreateIssueModal } from "../components/CreateIssueModal.js";
import { IssueDetailModal } from "../components/IssueDetailModal.js";

const COLUMNS: { status: IssueStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
];

type ColumnState = Record<IssueStatus, Issue[]>;

function groupByStatus(issues: Issue[]): ColumnState {
  const grouped: ColumnState = { backlog: [], todo: [], in_progress: [], in_review: [], done: [] };
  for (const issue of [...issues].sort((a, b) => a.position - b.position)) {
    grouped[issue.status].push(issue);
  }
  return grouped;
}

export default function BoardPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const issuesQuery = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => api.listIssues(projectId!),
    enabled: !!projectId,
  });

  const [columns, setColumns] = useState<ColumnState | null>(null);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [createStatus, setCreateStatus] = useState<IssueStatus | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);

  useEffect(() => {
    if (issuesQuery.data) setColumns(groupByStatus(issuesQuery.data));
  }, [issuesQuery.data]);

  const reorderMutation = useMutation({
    mutationFn: (updates: { id: string; status: IssueStatus; position: number }[]) =>
      api.reorderIssues(projectId!, updates),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
      queryClient.invalidateQueries({ queryKey: ["burndown"] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function findColumnOf(itemId: string, cols: ColumnState): IssueStatus | null {
    for (const status of Object.keys(cols) as IssueStatus[]) {
      if (cols[status].some((i) => i.id === itemId)) return status;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    if (!columns) return;
    const id = event.active.id as string;
    for (const status of Object.keys(columns) as IssueStatus[]) {
      const found = columns[status].find((i) => i.id === id);
      if (found) {
        setActiveIssue(found);
        return;
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveIssue(null);
    if (!columns) return;
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const sourceStatus = findColumnOf(activeId, columns);
    if (!sourceStatus) return;

    let destStatus: IssueStatus | null = null;
    if (overId.startsWith("column:")) {
      destStatus = overId.replace("column:", "") as IssueStatus;
    } else {
      destStatus = findColumnOf(overId, columns);
    }
    if (!destStatus) return;

    const next: ColumnState = { ...columns };
    const sourceItems = [...next[sourceStatus]];
    const oldIndex = sourceItems.findIndex((i) => i.id === activeId);
    if (oldIndex === -1) return;

    if (sourceStatus === destStatus) {
      const overIndex = sourceItems.findIndex((i) => i.id === overId);
      if (overIndex === -1 || overIndex === oldIndex) return;
      const [moved] = sourceItems.splice(oldIndex, 1);
      if (!moved) return;
      sourceItems.splice(overIndex, 0, moved);
      next[sourceStatus] = sourceItems;
      setColumns(next);
      reorderMutation.mutate(
        sourceItems.map((issue, index) => ({ id: issue.id, status: sourceStatus, position: index })),
      );
    } else {
      const [moved] = sourceItems.splice(oldIndex, 1);
      if (!moved) return;
      const destItems = [...next[destStatus]];
      const overIndex = destItems.findIndex((i) => i.id === overId);
      const insertIndex = overIndex >= 0 ? overIndex : destItems.length;
      destItems.splice(insertIndex, 0, { ...moved, status: destStatus });
      next[sourceStatus] = sourceItems;
      next[destStatus] = destItems;
      setColumns(next);
      reorderMutation.mutate([
        ...sourceItems.map((issue, index) => ({ id: issue.id, status: sourceStatus, position: index })),
        ...destItems.map((issue, index) => ({ id: issue.id, status: destStatus, position: index })),
      ]);
    }
  }

  if (issuesQuery.isLoading || !columns) {
    return (
      <div className="flex justify-center py-24 text-ink-faint">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              label={col.label}
              issues={columns[col.status]}
              onAdd={() => setCreateStatus(col.status)}
              onOpenIssue={setOpenIssueId}
            />
          ))}
        </div>
        <DragOverlay>{activeIssue && <IssueCard issue={activeIssue} onClick={() => {}} />}</DragOverlay>
      </DndContext>

      {projectId && createStatus && (
        <CreateIssueModal
          open={!!createStatus}
          onClose={() => setCreateStatus(null)}
          projectId={projectId}
          defaultStatus={createStatus}
        />
      )}
      {projectId && (
        <IssueDetailModal issueId={openIssueId} projectId={projectId} onClose={() => setOpenIssueId(null)} />
      )}
    </>
  );
}

function Column({
  status,
  label,
  issues,
  onAdd,
  onOpenIssue,
}: {
  status: IssueStatus;
  label: string;
  issues: Issue[];
  onAdd: () => void;
  onOpenIssue: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[400px] flex-col gap-2 rounded-md border border-border-subtle bg-surface/40 p-2 transition-colors ${
        isOver ? "border-accent/40 bg-surface2/40" : ""
      }`}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">{issues.length}</span>
          <button onClick={onAdd} className="text-ink-faint hover:text-accent" aria-label={`Add issue to ${label}`}>
            +
          </button>
        </div>
      </div>
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onClick={() => onOpenIssue(issue.id)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
