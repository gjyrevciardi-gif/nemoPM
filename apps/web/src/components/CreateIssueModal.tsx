import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IssueStatus, IssueType, Priority } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Button, Field, Modal, inputClass } from "./ui.js";

const TYPES: IssueType[] = ["epic", "story", "task", "bug", "subtask"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export function CreateIssueModal({
  open,
  onClose,
  projectId,
  defaultStatus = "backlog",
  sprintId = null,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultStatus?: IssueStatus;
  sprintId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<Priority>("medium");
  const [storyPoints, setStoryPoints] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createIssue({
        projectId,
        title,
        description: description || undefined,
        type,
        priority,
        status: defaultStatus,
        storyPoints: storyPoints ? Number(storyPoints) : undefined,
        sprintId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
      setTitle("");
      setDescription("");
      setStoryPoints("");
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New issue">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) mutation.mutate();
        }}
      >
        <Field label="Title">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={inputClass}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as IssueType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Points">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={100}
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
            />
          </Field>
        </div>
        {mutation.isError && (
          <p className="mb-3 text-sm text-risk-high">{(mutation.error as Error).message}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim() || mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create issue"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
