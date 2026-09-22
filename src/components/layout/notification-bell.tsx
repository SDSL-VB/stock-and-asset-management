"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Bell, CheckCheck, Clock, Inbox, PackageX } from "lucide-react";
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
 */

type Item = Awaited<ReturnType<typeof getMyNotifications>>["items"][number];

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
            {items.map((n) => {
              const Icon = KIND_ICON[n.kind];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn("flex w-full gap-2.5 px-3 py-2 text-left hover:bg-muted", !n.readAt && "bg-primary/5")}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block text-micro text-muted-foreground">{n.body}</span>}
                      <span className="block text-micro text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/settings/profile#notifications" className="block border-t px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
          Choose which ones come by mail
        </Link>
      </PopoverContent>
    </Popover>
  );
}
