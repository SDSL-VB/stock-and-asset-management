"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Inbox,
  PackageX,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { getMyNotifications, markNotificationsRead } from "@/lib/actions/notifications";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Everyone's bell. Shows the signed-in person's notifications — things waiting
 * on them, decisions on things they raised, low stock and late orders for
 * those who handle them (src/lib/notifications/notify.ts decides who).
 *
 * It loads in the browser after the page is up, again on each navigation and
 * every two minutes, so no page waits on it. Opening an item marks it read and
 * goes where it points; "Mark all read" clears the count.
 *
 * Notifications that carry the same `groupKey` are shown as ONE line that
 * opens — every component of one bill of materials that is low at one site,
 * rather than eleven separate lines burying everything else. Opening the group
 * marks the whole group read, because that is what was just read.
 */

type Item = Awaited<ReturnType<typeof getMyNotifications>>["items"][number];

/** A line in the bell: one notification, or a group that opens into several. */
type Line = { kind: "one"; item: Item } | { kind: "group"; key: string; label: string; items: Item[] };

/**
 * One line per notification, except where several share a group. A group of
 * one is left as a plain line — it would otherwise be a chevron hiding a
 * single item.
 */
function groupItems(items: Item[]): Line[] {
  const lines: Line[] = [];
  const groups = new Map<string, Extract<Line, { kind: "group" }>>();
  for (const item of items) {
    if (!item.groupKey) {
      lines.push({ kind: "one", item });
      continue;
    }
    let group = groups.get(item.groupKey);
    if (!group) {
      group = { kind: "group", key: item.groupKey, label: item.groupLabel ?? "Several items", items: [] };
      groups.set(item.groupKey, group);
      lines.push(group);
    }
    group.items.push(item);
  }
  return lines.map((line) => (line.kind === "group" && line.items.length === 1 ? { kind: "one", item: line.items[0] } : line));
}

const KIND_ICON = {
  ACTION: Inbox,
  DECIDED: CheckCheck,
  LOW_STOCK: PackageX,
  ORDER_LATE: Clock,
} as const;

export function NotificationBell() {
  const pathname = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const load = useCallback(() => {
    getMyNotifications()
      .then((res) => {
        setItems(res.items);
        setUnread(res.unread);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 120_000);
    return () => clearInterval(timer);
  }, [load, pathname]);

  async function open(item: Item) {
    if (!item.readAt) {
      await markNotificationsRead([item.id]);
      load();
    }
    if (item.href) router.push(item.href);
  }

  /** Opening a group reveals what is in it, and counts the lot as read. */
  async function toggleGroup(group: Extract<Line, { kind: "group" }>) {
    const nowOpen = openGroup !== group.key;
    setOpenGroup(nowOpen ? group.key : null);
    const unreadIds = group.items.filter((i) => !i.readAt).map((i) => i.id);
    if (nowOpen && unreadIds.length > 0) {
      await markNotificationsRead(unreadIds);
      load();
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={async () => {
                await markNotificationsRead();
                load();
              }}
            >
              Mark all read
            </Button>
          )}
        </div>
        {failed ? (
          <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" /> Could not load notifications.
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {groupItems(items).map((line) =>
              line.kind === "one" ? (
                <li key={line.item.id}>
                  <NotificationLine item={line.item} onOpen={() => open(line.item)} />
                </li>
              ) : (
                <li key={line.key}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(line)}
                    className={cn(
                      "flex w-full gap-2.5 px-3 py-2 text-left hover:bg-muted",
                      line.items.some((i) => !i.readAt) && "bg-primary/5"
                    )}
                  >
                    {openGroup === line.key ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", line.items.some((i) => !i.readAt) && "font-semibold")}>
                        {line.items.length} components low for {line.label}
                      </span>
                      <span className="block text-micro text-muted-foreground">
                        {line.items
                          .slice(0, 3)
                          .map((i) => i.title.split(" needs ordering")[0])
                          .join(", ")}
                        {line.items.length > 3 ? ` and ${line.items.length - 3} more` : ""}
                      </span>
                    </span>
                    {line.items.some((i) => !i.readAt) && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                    )}
                  </button>
                  {openGroup === line.key && (
                    <ul className="divide-y border-t bg-muted/30 pl-4">
                      {line.items.map((n) => (
                        <li key={n.id}>
                          <NotificationLine item={n} onOpen={() => open(n)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            )}
          </ul>
        )}
        <Link href="/settings/profile#notifications" className="block border-t px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
          Choose which ones come by mail
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** One notification, on its own or inside an opened group. */
function NotificationLine({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("flex w-full gap-2.5 px-3 py-2 text-left hover:bg-muted", !item.readAt && "bg-primary/5")}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", !item.readAt && "font-semibold")}>{item.title}</span>
        {item.body && <span className="block text-micro text-muted-foreground">{item.body}</span>}
        <span className="block text-micro text-muted-foreground">{formatDateTime(item.createdAt)}</span>
      </span>
      {!item.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </button>
  );
}
