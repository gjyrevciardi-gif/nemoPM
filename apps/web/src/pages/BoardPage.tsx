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
        <div className="flex h-full flex-col">
          <div className="mx-6 mt-4 flex flex-none items-center gap-8 rounded-[18px] border border-border-subtle bg-gradient-to-br from-white to-[#EFF9FF] px-5 py-3 shadow-card">
            {[{label:"TOTAL",value:Object.values(columns).flat().length},{label:"IN FLIGHT",value:columns.in_progress.length},{label:"REVIEW",value:columns.in_review.length},{label:"SHIPPED",value:columns.done.length}].map((metric, index) => <div key={metric.label} className="min-w-[76px]"><p className="font-mono text-[9px] tracking-[.16em] text-ink-faint">{metric.label}</p><p className="font-display text-2xl font-bold" style={{color:index === 1 ? "#E5793F" : "#002B4C"}}>{metric.value}</p></div>)}
            <button onClick={() => setCreateStatus("backlog")} className="ml-auto flex h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-[#FFC29C] to-[#F59E71] px-4 text-xs font-bold text-[#00243F] shadow-[0_12px_25px_-12px_rgba(245,158,113,1)]"><span className="text-xl leading-none">+</span> New card</button>
          </div>
          <div className="flex min-h-0 flex-1 gap-3.5 overflow-x-auto px-6 pb-5 pt-3">
          {COLUMNS.map((col, index) => (
            <Column
              key={col.status}
              status={col.status}
              label={col.label}
              issues={columns[col.status]}
              index={index}
              onAdd={() => setCreateStatus(col.status)}
              onOpenIssue={setOpenIssueId}
            />
          ))}
          </div>
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
  index,
}: {
  status: IssueStatus;
  label: string;
  issues: Issue[];
  onAdd: () => void;
  onOpenIssue: (id: string) => void;
  index: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

  return (
    <div
      ref={setNodeRef}
      className={`tide-column flex w-[294px] flex-none flex-col rounded-[18px] border border-border-subtle p-2.5 transition-colors ${
        isOver ? "border-accent bg-white/70" : ""
      }`}
    >
      <div className="flex items-center gap-2.5 px-1.5 pb-3 pt-1">
        <span className="h-2 w-2 rounded-[3px] shadow-[0_0_12px_currentColor]" style={{background:["#7891A1","#2B8FC4","#F59E71","#8859B6","#298C75"][index]}} />
        <span className="text-[11px] font-extrabold uppercase tracking-[.11em] text-ink/80">{label}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-faint">{issues.length}</span>
          <button onClick={onAdd} className="grid h-6 w-6 place-items-center rounded-lg bg-[#002b4c]/[.06] text-ink-faint hover:bg-accent/20 hover:text-accent" aria-label={`Add issue to ${label}`}>
            +
          </button>
        </div>
      </div>
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-0.5 pb-1">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onClick={() => onOpenIssue(issue.id)} />
          ))}
          {issues.length === 0 && <div className="rounded-[15px] border border-dashed border-border px-3 py-8 text-center text-xs text-ink-faint">still water</div>}
        </div>
      </SortableContext>
    </div>
  );
}
