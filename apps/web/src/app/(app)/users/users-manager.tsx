"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createUser, deleteUser, updateUser } from "./actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  projectIds: string[];
  projectNames: string[];
};

export type ProjectOption = { id: string; name: string };

type FormState = {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "STAFF";
  projectIds: string[];
};

const emptyForm: FormState = {
  name: "",
  email: "",
  password: "",
  role: "STAFF",
  projectIds: [],
};

export function UsersManager({
  users,
  projects,
  currentUserId,
}: {
  users: UserRow[];
  projects: ProjectOption[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserRow | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      projectIds: user.projectIds,
    });
    setOpen(true);
  }

  function toggleProject(projectId: string, checked: boolean) {
    setForm((prev) => ({
      ...prev,
      projectIds: checked
        ? [...new Set([...prev.projectIds, projectId])]
        : prev.projectIds.filter((id) => id !== projectId),
    }));
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        if (editing) {
          await updateUser({
            id: editing.id,
            name: form.name,
            email: form.email,
            password: form.password || undefined,
            role: form.role,
            projectIds: form.projectIds,
          });
          toast.success("User updated");
        } else {
          if (!form.password.trim()) {
            toast.error("Password is required");
            return;
          }
          await createUser({
            name: form.name,
            email: form.email,
            password: form.password,
            role: form.role,
            projectIds: form.projectIds,
          });
          toast.success("User created");
        }
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function requestDelete(user: UserRow) {
    if (user.id === currentUserId) {
      toast.error("You cannot delete your own account");
      return;
    }
    setUserToDelete(user);
  }

  async function performDelete() {
    if (!userToDelete) return;
    setDeletingId(userToDelete.id);
    try {
      await deleteUser(userToDelete.id);
      toast.success(`User ${userToDelete.name} deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      throw err;
    } finally {
      setDeletingId(null);
      setUserToDelete(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" className="gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          Add user
        </Button>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No users yet. Add your first account.
          </p>
        ) : (
          users.map((user) => (
          <div
            key={user.id}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                {user.role}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Projects:{" "}
              {user.projectNames.length === 0
                ? "—"
                : user.projectNames.join(", ")}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => openEdit(user)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 text-destructive"
                disabled={
                  user.id === currentUserId || deletingId === user.id
                }
                onClick={() => requestDelete(user)}
              >
                {deletingId === user.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Delete
              </Button>
            </div>
          </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        {users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No users yet. Add your first account.
          </p>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge
                    variant={user.role === "ADMIN" ? "default" : "secondary"}
                  >
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.projectNames.length === 0
                    ? "—"
                    : user.projectNames.join(", ")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(user)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={
                        user.id === currentUserId || deletingId === user.id
                      }
                      onClick={() => requestDelete(user)}
                    >
                      {deletingId === user.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update profile, role, and project access. Leave password blank to keep the current one."
                : "Create an admin or staff account. Staff should be assigned to projects."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-password">
                Password{editing ? " (optional)" : ""}
              </Label>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, password: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    role: (value as "ADMIN" | "STAFF") ?? "STAFF",
                    projectIds:
                      value === "ADMIN" ? [] : prev.projectIds,
                  }))
                }
                items={[
                  { value: "ADMIN", label: "ADMIN" },
                  { value: "STAFF", label: "STAFF" },
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                  <SelectItem value="STAFF">STAFF</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.role === "STAFF" && (
              <div className="grid gap-2">
                <Label>Assigned projects</Label>
                {projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No projects yet. Seed or create a project first.
                  </p>
                ) : (
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                    {projects.map((project) => {
                      const checked = form.projectIds.includes(project.id);
                      return (
                        <label
                          key={project.id}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              toggleProject(project.id, value)
                            }
                          />
                          <span>{project.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : editing ? (
                "Save changes"
              ) : (
                "Create user"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(userToDelete)}
        onOpenChange={(open) => {
          if (!open) setUserToDelete(null);
        }}
        title={`Delete User "${userToDelete?.name}"?`}
        description={`Are you sure you want to delete user ${userToDelete?.name} (${userToDelete?.email})? This action cannot be undone.`}
        confirmLabel="Delete User"
        onConfirm={performDelete}
      />
    </div>
  );
}
