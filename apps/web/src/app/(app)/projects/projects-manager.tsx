"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { parseBudgetInput } from "@/lib/projects/budget";
import { createProject, updateProject, deleteProject } from "./actions";

export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  status: string;
  userIds: string[];
  memberNames: string[];
  // AI settings (the saved key itself is never sent to the browser)
  azureEndpoint?: string | null;
  azureKeyHint?: string | null;
  monthlyPageLimit?: number;
  pagesUsed?: number;
  /** Spending limit as a plain number, or null for none. */
  budget?: number | null;
  /** Total of the project's confirmed invoices. */
  spent?: number;
};

type FormState = {
  name: string;
  description: string;
  address: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  userIds: string[];
  azureEndpoint: string;
  azureKey: string;
  clearAzureKey: boolean;
  monthlyPageLimit: string;
  budget: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  address: "",
  status: "ACTIVE",
  userIds: [],
  azureEndpoint: "",
  azureKey: "",
  clearAzureKey: false,
  monthlyPageLimit: "500",
  budget: "",
};

function ProjectFormDialog({
  open,
  onOpenChange,
  editing,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ProjectRow | null;
  users: AssignableUser[];
}) {
  const [form, setForm] = useState<FormState>(() =>
    editing
      ? {
          name: editing.name,
          description: editing.description ?? "",
          address: editing.address ?? "",
          status: (editing.status as FormState["status"]) ?? "ACTIVE",
          userIds: editing.userIds,
          azureEndpoint: editing.azureEndpoint ?? "",
          azureKey: "",
          clearAzureKey: false,
          monthlyPageLimit: String(editing.monthlyPageLimit ?? 500),
          budget: editing.budget ? String(editing.budget) : "",
        }
      : emptyForm
  );
  const [pending, startTransition] = useTransition();

  function toggleUser(userId: string, checked: boolean) {
    setForm((prev) => ({
      ...prev,
      userIds: checked
        ? [...new Set([...prev.userIds, userId])]
        : prev.userIds.filter((id) => id !== userId),
    }));
  }

  function submit() {
    const limit = Number(form.monthlyPageLimit);
    if (!Number.isInteger(limit) || limit < 0) {
      toast.error("Monthly page limit must be a whole number (0 or more).");
      return;
    }
    const budget = parseBudgetInput(form.budget);
    if (!budget.ok) {
      toast.error(budget.error);
      return;
    }
    const payload = {
      ...form,
      monthlyPageLimit: limit,
      azureEndpoint: form.azureEndpoint.trim() || undefined,
      azureKey: form.azureKey.trim() || undefined,
    };
    startTransition(async () => {
      try {
        if (editing) {
          await updateProject({ id: editing.id, ...payload });
          toast.success("Project updated");
        } else {
          await createProject(payload);
          toast.success("Project created");
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update project details and assigned staff."
              : "Create a project/site and assign staff members."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-address">Address</Label>
            <Input
              id="project-address"
              value={form.address}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-budget">Budget (optional)</Label>
            <Input
              id="project-budget"
              inputMode="decimal"
              placeholder="For example 2500000"
              value={form.budget}
              onChange={(e) => setForm((prev) => ({ ...prev, budget: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              The most you plan to spend on this project. You are warned at 80% and again at 100%, on the dashboard and in the daily email. Leave empty for no budget.
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  status: (value as FormState["status"]) ?? "ACTIVE",
                }))
              }
              items={[
                { value: "ACTIVE", label: "Active" },
                { value: "COMPLETED", label: "Completed" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">AI invoice reading (Azure)</p>
              <p className="text-xs text-muted-foreground">
                {editing && editing.pagesUsed !== undefined
                  ? `${editing.pagesUsed} of ${form.monthlyPageLimit || 0} pages used this month. `
                  : ""}
                Pages are counted when a file is read, and deleting an invoice
                does not give them back.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-page-limit">Monthly page limit</Label>
              <Input
                id="project-page-limit"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.monthlyPageLimit}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, monthlyPageLimit: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-azure-endpoint">Azure endpoint</Label>
              <Input
                id="project-azure-endpoint"
                placeholder="https://your-resource.cognitiveservices.azure.com/"
                autoComplete="off"
                value={form.azureEndpoint}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, azureEndpoint: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-azure-key">Azure key</Label>
              <Input
                id="project-azure-key"
                type="password"
                autoComplete="new-password"
                placeholder={
                  editing?.azureKeyHint
                    ? `Saved (ends in ${editing.azureKeyHint}) - leave blank to keep`
                    : "Paste the key from Azure"
                }
                value={form.azureKey}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, azureKey: e.target.value }))
                }
              />
              {editing?.azureKeyHint && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={form.clearAzureKey}
                    onCheckedChange={(value) =>
                      setForm((prev) => ({ ...prev, clearAzureKey: value === true }))
                    }
                  />
                  Remove this project&apos;s key (use the server default)
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                The key is stored encrypted and is never shown again.
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Assigned staff</Label>
            {users.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No staff users to assign yet.
              </p>
            ) : (
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                {users.map((user) => {
                  const checked = form.userIds.includes(user.id);
                  return (
                    <label
                      key={user.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleUser(user.id, value === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{user.name}</span>
                      <span className="text-xs text-muted-foreground">{user.role}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !form.name.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save changes" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsManager({ users, limitMessage }: { users: AssignableUser[]; limitMessage?: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        className="w-full gap-1.5 sm:w-auto"
        disabled={Boolean(limitMessage)}
        title={limitMessage ?? undefined}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        New project
      </Button>
      <ProjectFormDialog
        key={open ? "new" : "closed"}
        open={open}
        onOpenChange={setOpen}
        editing={null}
        users={users}
      />
    </>
  );
}

export function ProjectActions({
  project,
  users,
}: {
  project: ProjectRow;
  users: AssignableUser[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The confirm dialog awaits this and keeps itself open when it throws, so the person sees the reason and can cancel.
  // (Throwing from inside a transition instead would send the error to the page's error boundary.)
  async function performDelete() {
    try {
      await deleteProject(project.id);
      toast.success(`Project "${project.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      throw err;
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${project.name}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <ProjectFormDialog
        key={editOpen ? project.id : "closed"}
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={project}
        users={users}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete project "${project.name}"?`}
        description="This will permanently remove the project. Invoices linked to this project will block deletion."
        confirmLabel="Delete project"
        onConfirm={performDelete}
      />
    </>
  );
}
