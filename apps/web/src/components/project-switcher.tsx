"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProjectOption = { id: string; name: string; status: string };

export function ProjectSwitcher({
  role,
  projects,
  selectedProjectId,
}: {
  role: "ADMIN" | "STAFF";
  projects: ProjectOption[];
  selectedProjectId: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const items = [
    ...(role === "ADMIN" ? [{ value: "ALL", label: "All projects" }] : []),
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ];

  if (projects.length === 0) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <FolderKanban className="size-4 shrink-0" />
        <span className="truncate">No project assigned</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <FolderKanban className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      <Select
        value={selectedProjectId ?? "ALL"}
        items={items}
        disabled={pending}
        onValueChange={async (value) => {
          setPending(true);
          try {
            const response = await fetch("/api/project-scope", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ projectId: value === "ALL" ? null : value }),
            });
            if (!response.ok) throw new Error("Unable to switch project");
            router.refresh();
          } finally {
            setPending(false);
          }
        }}
      >
        <SelectTrigger
          aria-label="Current project"
          className="h-9 w-[min(38vw,240px)] rounded-lg border-border/80 bg-background text-xs shadow-none hover:bg-muted/40 transition-colors sm:w-60 sm:text-sm"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent align="start">
          {role === "ADMIN" && <SelectItem value="ALL">All projects</SelectItem>}
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
