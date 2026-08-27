"use client";

import { useState } from "react";
import { Activity, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { Stagger, StaggerItem } from "@/components/motion";
import { getSearchableActivity } from "@/lib/actions/dashboard";
import { initialsOf, timeAgo } from "@/lib/format";

interface ActivityItem {
  id: string;
  action: string;
  entity: string;
  details: string | null;
  createdAt: Date;
  user: { name: string };
}

interface RecentActivityProps {
  activities: ActivityItem[];
  /** Adds the server-backed search box above the feed. */
  searchable?: boolean;
}

function formatAction(activity: ActivityItem): string {
  if (activity.details) return activity.details;
  return `${activity.action.toLowerCase()} a ${activity.entity.toLowerCase()}`;
}

/**
 * The activity feed. The super-admin dashboard used to reimplement this inline
 * — including its own copy of timeAgo — purely to add a search box, so search
 * is now an option on the shared component instead.
 */
export function RecentActivity({
  activities,
  searchable = false,
}: RecentActivityProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ActivityItem[] | null>(null);

  async function handleSearch(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    setResults(await getSearchableActivity(value));
  }

  const displayed = results ?? activities;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-status-info" />
          Recent Activity
        </CardTitle>
        {searchable && (
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search activity..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {displayed.length === 0 ? (
          <EmptyState
            emoji={query ? "🔍" : "📭"}
            title={query ? "No matching activity" : "Nothing here yet"}
            description={
              query
                ? "Try a different name, action, or entry number."
                : "Activity will appear here as your team works."
            }
            className="py-8"
          />
        ) : (
          <Stagger className="space-y-4" stagger={0.04}>
            {displayed.map((activity) => (
              <StaggerItem key={activity.id}>
                <div className="flex items-start gap-3">
                  <Avatar className="mt-0.5 size-8 shrink-0">
                    <AvatarFallback className="bg-brand-green/10 text-micro font-bold text-status-approved">
                      {initialsOf(activity.user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-body">
                      <span className="font-semibold">{activity.user.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {formatAction(activity)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {timeAgo(activity.createdAt)}
                    </p>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </CardContent>
    </Card>
  );
}
