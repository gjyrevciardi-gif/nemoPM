import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@ai-pm/shared";
import { PriorityMark, TypeIcon } from "./ui.js";

export function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="card cursor-grab space-y-2 p-3 active:cursor-grabbing"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-ink-faint">{issue.key}</span>
        <TypeIcon type={issue.type} />
      </div>
      <p className="text-sm font-medium leading-snug text-ink">{issue.title}</p>
      <div className="flex items-center justify-between">
        <PriorityMark priority={issue.priority} />
        {issue.storyPoints != null && (
          <span className="rounded-sm bg-surface3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            {issue.storyPoints} pt
          </span>
        )}
      </div>
    </div>
  );
}
