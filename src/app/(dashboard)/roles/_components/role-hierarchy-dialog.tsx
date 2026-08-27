"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Network } from "lucide-react";
import { RoleHierarchy } from "./role-hierarchy";

type Role = React.ComponentProps<typeof RoleHierarchy>["roles"][number];

interface Props {
  roles: Role[];
  canEdit: boolean;
}

export function RoleHierarchyDialog({ roles, canEdit }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Network className="mr-2 h-4 w-4" />
        Show Role Hierarchy
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Role Hierarchy</DialogTitle>
        </DialogHeader>
        <RoleHierarchy roles={roles} canEdit={canEdit} />
      </DialogContent>
    </Dialog>
  );
}
