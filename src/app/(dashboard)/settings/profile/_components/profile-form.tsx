"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { UserCircle, Mail, Shield, KeyRound } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface Props {
  user: {
    name: string;
    email: string;
    role: string;
  };
}

export function ProfileForm({ user }: Props) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="grid gap-6 lg:grid-cols-3 max-w-4xl">
      <Card className="lg:col-span-1">
        <CardContent className="p-6 text-center">
          <Avatar className="h-20 w-20 mx-auto">
            <AvatarFallback className="bg-brand-green/10 text-brand-green text-2xl font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <h2 className="mt-4 text-lg font-semibold">{user.name}</h2>
          <Badge variant="secondary" className="mt-2">
            {user.role}
          </Badge>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-brand-green" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Full Name</Label>
            <p className="text-sm font-medium p-2 rounded-md bg-muted">
              {user.name}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs flex items-center gap-1">
              <Mail className="h-3 w-3" />
              Email
            </Label>
            <p className="text-sm font-medium p-2 rounded-md bg-muted">
              {user.email}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs flex items-center gap-1">
              <Shield className="h-3 w-3" />
              Role
            </Label>
            <p className="text-sm font-medium p-2 rounded-md bg-muted">
              {user.role}
            </p>
          </div>
          {/* Your password is the one thing here you can change yourself, so the
              note below no longer claims otherwise. */}
          <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Contact your administrator to change your name, email or role.
            </p>
            <Button
              render={<Link href="/settings/password" />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="shrink-0"
            >
              <KeyRound />
              Change password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
