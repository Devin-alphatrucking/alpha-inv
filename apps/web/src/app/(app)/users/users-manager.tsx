"use client";

import { StepUpDialog } from "@/components/step-up-dialog";
import { needsProjects, ROLE_INFO, ROLES, type RoleName } from "@/lib/roles";
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
import { PasswordDialog } from "./password-dialog";
import { formatPhone } from "@/lib/security/phone";
import { KeyRound } from "lucide-react";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  sharedWithOtherCompanies: boolean;
  role: RoleName;
  projectIds: string[];
  projectNames: string[];
};

export type ProjectOption = { id: string; name: string };

type FormState = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: RoleName;
  projectIds: string[];
};

const emptyForm: FormState = {
  name: "",
  email: "",
  phone: "",
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
  const [stepUpFor, setStepUpFor] = useState<UserRow | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserRow | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserRow | null>(null);

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
      phone: user.phone ?? "",
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
            phone: form.phone,
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
            phone: form.phone,
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
    const target = userToDelete;
    setDeletingId(target.id);
    try {
      const r = await deleteUser(target.id);
      if (r.ok) toast.success(`User ${target.name} deleted`);
      else if (r.needsCode) setStepUpFor(target); // the next step asks for the code emailed to you
      else toast.error(r.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
      setUserToDelete(null);
    }
  }

  async function deleteWithCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!stepUpFor) return { ok: false, error: "Nobody is selected." };
    const target = stepUpFor;
    const r = await deleteUser(target.id, code);
    if (!r.ok) return { ok: false, error: r.error };
    toast.success(`User ${target.name} deleted`);
    setStepUpFor(null);
    return { ok: true };
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
                {user.phone && <p className="truncate text-sm text-muted-foreground">{formatPhone(user.phone)}</p>}
              </div>
              <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                {ROLE_INFO[user.role].label}
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
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setPasswordFor(user)}>
                <KeyRound className="size-3.5" />
                Password
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
              <TableHead>Mobile</TableHead>
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
                <TableCell className="whitespace-nowrap">{user.phone ? formatPhone(user.phone) : "—"}</TableCell>
                <TableCell>
                  <Badge
                    variant={user.role === "ADMIN" ? "default" : "secondary"}
                  >
                    {ROLE_INFO[user.role].label}
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
                    <Button type="button" size="sm" variant="outline" onClick={() => setPasswordFor(user)}>
                      <KeyRound className="size-3.5" />
                      Password
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
                ? "Update profile, role, and project access."
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
              <Label htmlFor="user-phone">Mobile number (optional)</Label>
              <Input id="user-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="98765 43210" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
            {editing ? (
              <p className="text-xs text-muted-foreground">To change their password use the Password button in the list.</p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="user-password">Password</Label>
                <Input id="user-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
              </div>
            )}
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    role: (value as RoleName) ?? "STAFF",
                    projectIds:
                      value && needsProjects(value as RoleName) ? prev.projectIds : [],
                  }))
                }
                items={ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_INFO[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_INFO[form.role].summary}</p>
            </div>

            {needsProjects(form.role) && (
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

      <PasswordDialog
        target={passwordFor ? { id: passwordFor.id, name: passwordFor.name, email: passwordFor.email, sharedWithOtherCompanies: passwordFor.sharedWithOtherCompanies } : null}
        onClose={() => setPasswordFor(null)}
      />

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
      <StepUpDialog open={Boolean(stepUpFor)} onOpenChange={(open) => !open && setStepUpFor(null)} action="Remove a person from the company" onConfirm={deleteWithCode} />
    </div>
  );
}
