import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@ai-pm/shared";

const TYPE_COLOR: Record<string, string> = { bug: "#E66A5C", story: "#2B8FC4", epic: "#8859B6", task: "#298C75", subtask: "#60798A" };
const PRIORITY_BARS: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 3 };

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
      className="tide-card cursor-grab rounded-[15px] border border-border bg-white p-3.5 shadow-card active:cursor-grabbing"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface2 px-2 py-1 font-mono text-[9px] uppercase tracking-widest" style={{ color: TYPE_COLOR[issue.type] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_COLOR[issue.type] }} />{issue.type}
        </span>
        <span className="font-mono text-[10px] text-ink-faint">{issue.key}</span>
        <span className="ml-auto flex items-end gap-0.5" title={`${issue.priority} priority`}>
          {[1,2,3].map((bar) => <span key={bar} className="w-[3px] rounded-full" style={{ height: 3 + bar * 2, background: bar <= (PRIORITY_BARS[issue.priority] ?? 1) ? (issue.priority === "critical" ? "#E66A5C" : "#F59E71") : "rgba(0,43,76,.13)" }} />)}
        </span>
      </div>
      <p className="text-[13.5px] font-semibold leading-snug text-ink">{issue.title}</p>
      <div className="mt-4 flex items-center gap-2">
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#2B8FC4] to-[#F59E71]" style={{ width: issue.status === "done" ? "100%" : issue.status === "in_review" ? "80%" : issue.status === "in_progress" ? "55%" : "18%" }} /></div>
        {issue.storyPoints != null && (
          <span className="rounded-md bg-white/[.07] px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink-muted">
            {issue.storyPoints} PT
          </span>
        )}
      </div>
    </div>
  );
}
